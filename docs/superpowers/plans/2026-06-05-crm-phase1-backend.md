# CRM Phase 1 — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add revenue/forecast, conversion-funnel, lost-reason capture, and "needs attention" detection + a daily digest to the School CRM backend, computed on read, with the digest disabled-by-default and dry-runnable.

**Architecture:** Approach B (compute-on-read). Persist only 3 new lead fields + one settings doc (`db.settings {type:"crm_pipeline"}`). All derived numbers (weighted value, funnel %, attention flags) are pure functions computed at query time and reused by the scheduler. New routes follow the existing flat `/leads/...` style in `routes/crm_routes.py`; settings under `/pipeline-settings`. The digest is a 6th asyncio loop in `scheduler.py`, gated by `digest_enabled` and `CRM_DIGEST_DRY_RUN`, reusing existing `_resolve_recipient`, `_fms_send_wa`, `_fms_send_email`.

**Tech Stack:** FastAPI + Motor (async MongoDB), pytest integration tests (login as `info@smartshape.in`, hit `${REACT_APP_BACKEND_URL}/api/...`).

**Safety:** Running the backend locally targets the **production DB** and live schedulers. Tests must create `TEST_`-prefixed leads and clean them up (existing pattern). The `/pipeline-settings` PUT test must snapshot-and-restore the settings doc. The digest job must never send unless `digest_enabled` is true AND `CRM_DIGEST_DRY_RUN` is unset.

---

## File Structure

- `backend/routes/crm_routes.py` — add: settings helper + defaults, pure compute functions (`resolve_lead_value`, `stage_probability`, `compute_attention`), enrich `get_leads`, extend `create_lead`/`update_lead`, new endpoints (`/pipeline-settings` GET/PUT, `/leads/forecast`, `/leads/funnel`, `/leads/needs-attention`).
- `backend/scheduler.py` — add: `CRM_DIGEST_DRY_RUN`, `run_crm_digest()`, `crm_digest_loop()`, register in `start_scheduler()`.
- `backend/tests/test_crm_phase1.py` — new integration test file covering every endpoint.

All compute functions live in `crm_routes.py` so the scheduler can import them (DRY) — `scheduler.py` already imports from `routes.fms_routes`.

---

## Task 1: Pipeline settings doc + helper

**Files:**
- Modify: `backend/routes/crm_routes.py` (add near top, after the `log_activity` helper ~line 90)
- Test: `backend/tests/test_crm_phase1.py`

- [ ] **Step 1: Write the failing test**

```python
"""Phase 1 CRM: forecast, funnel, needs-attention, settings."""
import os, uuid, requests, pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

def _login():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": "info@smartshape.in", "password": "admin123"})
    assert r.status_code == 200, f"login failed: {r.text}"
    return s

class TestPipelineSettings:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        # snapshot current settings so the PUT test restores them
        self.original = self.s.get(f"{BASE}/api/pipeline-settings").json()
        yield
        self.s.put(f"{BASE}/api/pipeline-settings", json=self.original)

    def test_get_defaults(self):
        r = self.s.get(f"{BASE}/api/pipeline-settings")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["stage_probabilities"]["negotiation"] == 70
        assert d["stage_idle_limits"]["negotiation"] == 3
        assert "Price" in d["lost_reasons"]
        assert d["digest_enabled"] is False

    def test_put_merges(self):
        r = self.s.put(f"{BASE}/api/pipeline-settings", json={
            "stage_probabilities": {"negotiation": 80}, "digest_time": "09:30"
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["stage_probabilities"]["negotiation"] == 80
        assert d["stage_probabilities"]["new"] == 10   # default preserved
        assert d["digest_time"] == "09:30"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestPipelineSettings -v`
Expected: FAIL — 404 on `/api/pipeline-settings`.

- [ ] **Step 3: Implement settings helper + endpoints**

Add after `log_activity` (~line 90) in `crm_routes.py`:

```python
OPEN_STAGES = ["new", "contacted", "demo", "quoted", "negotiation"]

DEFAULT_PIPELINE_SETTINGS = {
    "type": "crm_pipeline",
    "stage_probabilities": {
        "new": 10, "contacted": 20, "demo": 30, "quoted": 50,
        "negotiation": 70, "won": 100, "lost": 0, "retention": 0, "resell": 0,
    },
    "stage_idle_limits": {
        "new": 7, "contacted": 5, "demo": 4, "quoted": 4,
        "negotiation": 3, "retention": 30, "resell": 14,
    },
    "lost_reasons": ["Price", "Competitor", "No budget", "No response", "Timing", "Other"],
    "digest_time": "08:00",
    "digest_enabled": False,
}


async def get_crm_settings() -> dict:
    doc = await db.settings.find_one({"type": "crm_pipeline"}, {"_id": 0})
    if not doc:
        await db.settings.insert_one(dict(DEFAULT_PIPELINE_SETTINGS))
        doc = {}
    merged = {**DEFAULT_PIPELINE_SETTINGS, **doc}
    for mk in ("stage_probabilities", "stage_idle_limits"):
        merged[mk] = {**DEFAULT_PIPELINE_SETTINGS[mk], **(doc.get(mk) or {})}
    merged.pop("_id", None)
    return merged
```

Add endpoints near the other master endpoints (e.g. after the `/sources` block ~line 224):

```python
@router.get("/pipeline-settings")
async def get_pipeline_settings(request: Request):
    await get_current_user(request)
    return await get_crm_settings()


@router.put("/pipeline-settings")
async def update_pipeline_settings(request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    allowed = {}
    for k in ("stage_probabilities", "stage_idle_limits", "lost_reasons",
              "digest_time", "digest_enabled"):
        if k in body:
            allowed[k] = body[k]
    if allowed:
        await db.settings.update_one(
            {"type": "crm_pipeline"}, {"$set": allowed}, upsert=True
        )
    return await get_crm_settings()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestPipelineSettings -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/crm_routes.py backend/tests/test_crm_phase1.py
git commit -m "feat(crm): pipeline settings doc + GET/PUT endpoints"
```

---

## Task 2: Deal-value + probability pure functions, enrich get_leads

**Files:**
- Modify: `backend/routes/crm_routes.py` (compute fns near `calc_lead_score`; enrich `get_leads` ~line 1150-1163)
- Test: `backend/tests/test_crm_phase1.py`

- [ ] **Step 1: Write the failing test**

```python
class TestLeadValueEnrichment:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_expected_value_drives_weighted(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_Val_{uid}", "contact_name": "T",
            "contact_phone": "9000000000", "stage": "negotiation",
            "expected_value": 100000,
        })
        assert r.status_code == 200, r.text
        self.lead_id = r.json()["lead_id"]
        leads = self.s.get(f"{BASE}/api/leads").json()
        lead = next(l for l in leads if l["lead_id"] == self.lead_id)
        assert lead["deal_value"] == 100000
        # negotiation default probability = 70 -> weighted 70000
        assert lead["weighted_value"] == 70000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestLeadValueEnrichment -v`
Expected: FAIL — `create_lead` ignores `expected_value`; `deal_value` key missing.

(NOTE: this test also depends on Task 3 storing `expected_value`. Implement Step 3 here AND Task 3 Step 3 before re-running; they are split for clarity but land together. If running strictly task-by-task, expect this test to stay red until Task 3 is done — that is acceptable.)

- [ ] **Step 3: Implement pure functions + enrich get_leads**

Add near `calc_lead_score` in `crm_routes.py`:

```python
def resolve_lead_value(lead: dict, quote_map: dict) -> float:
    """Linked quotation grand_total (latest) wins; else manual expected_value."""
    qids = lead.get("quotation_ids") or []
    linked = [quote_map[q] for q in qids if q in quote_map]
    if linked:
        latest = max(linked, key=lambda q: q.get("created_at", "") or "")
        return float(latest.get("grand_total", 0) or 0)
    return float(lead.get("expected_value", 0) or 0)


def stage_probability(stage: str, settings: dict) -> int:
    return int((settings.get("stage_probabilities") or {}).get(stage, 0) or 0)


async def _build_quote_map(leads: list) -> dict:
    ids = [q for l in leads for q in (l.get("quotation_ids") or [])]
    qmap = {}
    if ids:
        async for q in db.quotations.find(
            {"quotation_id": {"$in": ids}},
            {"_id": 0, "quotation_id": 1, "grand_total": 1, "created_at": 1},
        ):
            qmap[q["quotation_id"]] = q
    return qmap
```

In `get_leads`, before the `for lead in leads:` loop, add:

```python
    settings = await get_crm_settings()
    quote_map = await _build_quote_map(leads)
```

Inside that loop (after `lead["lead_score"] = ...`), add:

```python
        lead["deal_value"] = resolve_lead_value(lead, quote_map)
        lead["probability"] = stage_probability(lead.get("stage", ""), settings)
        lead["weighted_value"] = round(lead["deal_value"] * lead["probability"] / 100, 2)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestLeadValueEnrichment -v`
Expected: PASS (after Task 3 lands).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/crm_routes.py backend/tests/test_crm_phase1.py
git commit -m "feat(crm): deal_value + weighted_value enrichment on leads"
```

---

## Task 3: Store expected_value + lost_reason on create/update

**Files:**
- Modify: `backend/routes/crm_routes.py` — `create_lead` (~1203-1240), `update_lead` (~1255-1289)
- Test: `backend/tests/test_crm_phase1.py`

- [ ] **Step 1: Write the failing test**

```python
class TestLostReason:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_lost_requires_reason(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_Lost_{uid}", "contact_name": "T",
            "contact_phone": "9000000001", "stage": "negotiation",
        })
        self.lead_id = r.json()["lead_id"]
        # moving to lost without a reason is rejected
        r1 = self.s.put(f"{BASE}/api/leads/{self.lead_id}", json={"stage": "lost"})
        assert r1.status_code == 400, r1.text
        # with a reason it succeeds and persists
        r2 = self.s.put(f"{BASE}/api/leads/{self.lead_id}", json={
            "stage": "lost", "lost_reason": "Price", "lost_reason_note": "too high"
        })
        assert r2.status_code == 200, r2.text
        assert r2.json()["lost_reason"] == "Price"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestLostReason -v`
Expected: FAIL — move to lost currently returns 200 with no reason.

- [ ] **Step 3: Implement**

In `create_lead`'s `lead_doc`, add these keys (alongside `notes`):

```python
        "expected_value": float(body.get("expected_value", 0) or 0),
        "lost_reason": body.get("lost_reason", ""),
        "lost_reason_note": body.get("lost_reason_note", ""),
```

In `update_lead`, add the validation BEFORE building `allowed` (right after the locked-lead check ~line 1271):

```python
    moving_to_lost = body.get("stage") == "lost" and existing.get("stage") != "lost"
    if moving_to_lost:
        reason = (body.get("lost_reason") or existing.get("lost_reason") or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="lost_reason is required when marking a lead Lost")
```

Add `"expected_value"`, `"lost_reason"`, `"lost_reason_note"` to the `update_lead` allowed-keys tuple (the `for k in (...)` list ~line 1256). For `expected_value`, coerce to float — after the loop, add:

```python
    if "expected_value" in allowed:
        allowed["expected_value"] = float(allowed["expected_value"] or 0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestLostReason tests/test_crm_phase1.py::TestLeadValueEnrichment -v`
Expected: PASS (both classes).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/crm_routes.py backend/tests/test_crm_phase1.py
git commit -m "feat(crm): store expected_value + required lost_reason on lost"
```

---

## Task 4: Forecast endpoint

**Files:**
- Modify: `backend/routes/crm_routes.py` (add after `referral_leaderboard` ~line 1327, so it is declared before `/leads/{lead_id}`-style param routes)
- Test: `backend/tests/test_crm_phase1.py`

- [ ] **Step 1: Write the failing test**

```python
class TestForecast:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_forecast_shape_and_weighting(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_Fc_{uid}", "contact_name": "T",
            "contact_phone": "9000000002", "stage": "quoted", "expected_value": 50000,
        })
        self.lead_id = r.json()["lead_id"]
        f = self.s.get(f"{BASE}/api/leads/forecast")
        assert f.status_code == 200, f.text
        d = f.json()
        assert "total_value" in d and "total_weighted" in d
        assert "by_stage" in d and "by_rep" in d
        quoted = d["by_stage"]["quoted"]
        assert quoted["count"] >= 1
        assert quoted["value"] >= 50000          # our lead included
        assert quoted["weighted"] >= 25000       # quoted prob 50%
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestForecast -v`
Expected: FAIL — 404 on `/api/leads/forecast`.

- [ ] **Step 3: Implement**

```python
@router.get("/leads/forecast")
async def leads_forecast(request: Request):
    """Weighted pipeline forecast over OPEN stages, RBAC-scoped, per-stage + per-rep."""
    user = await get_current_user(request)
    team = get_team(user)
    if team in ("accounts", "store"):
        return {"total_value": 0, "total_weighted": 0, "by_stage": {}, "by_rep": {}}
    query = {} if team == "admin" else {"assigned_to": user["email"]}
    query["stage"] = {"$in": OPEN_STAGES}
    leads = await db.leads.find(query, {"_id": 0}).to_list(10000)
    settings = await get_crm_settings()
    quote_map = await _build_quote_map(leads)

    by_stage = {s: {"count": 0, "value": 0.0, "weighted": 0.0} for s in OPEN_STAGES}
    by_rep = {}
    total_value = total_weighted = 0.0
    for lead in leads:
        stage = lead.get("stage", "")
        if stage not in by_stage:
            continue
        value = resolve_lead_value(lead, quote_map)
        weighted = round(value * stage_probability(stage, settings) / 100, 2)
        by_stage[stage]["count"] += 1
        by_stage[stage]["value"] = round(by_stage[stage]["value"] + value, 2)
        by_stage[stage]["weighted"] = round(by_stage[stage]["weighted"] + weighted, 2)
        rep = lead.get("assigned_name") or lead.get("assigned_to") or "Unassigned"
        r = by_rep.setdefault(rep, {"count": 0, "value": 0.0, "weighted": 0.0})
        r["count"] += 1
        r["value"] = round(r["value"] + value, 2)
        r["weighted"] = round(r["weighted"] + weighted, 2)
        total_value += value
        total_weighted += weighted
    return {
        "total_value": round(total_value, 2),
        "total_weighted": round(total_weighted, 2),
        "by_stage": by_stage,
        "by_rep": by_rep,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestForecast -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/crm_routes.py backend/tests/test_crm_phase1.py
git commit -m "feat(crm): weighted pipeline forecast endpoint"
```

---

## Task 5: Conversion funnel endpoint

**Files:**
- Modify: `backend/routes/crm_routes.py` (add after `leads_forecast`)
- Test: `backend/tests/test_crm_phase1.py`

- [ ] **Step 1: Write the failing test**

```python
class TestFunnel:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        yield

    def test_funnel_shape(self):
        f = self.s.get(f"{BASE}/api/leads/funnel")
        assert f.status_code == 200, f.text
        d = f.json()
        assert "stages" in d and isinstance(d["stages"], list)
        assert {"stage", "count", "advanced_pct", "avg_days"} <= set(d["stages"][0].keys())
        assert "won" in d and "lost" in d
        assert "lost_reasons" in d and isinstance(d["lost_reasons"], dict)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestFunnel -v`
Expected: FAIL — 404 on `/api/leads/funnel`.

- [ ] **Step 3: Implement**

```python
FUNNEL_ORDER = ["new", "contacted", "demo", "quoted", "negotiation", "won"]
FUNNEL_RANK = {s: i for i, s in enumerate(FUNNEL_ORDER)}


def _max_stage_reached(lead: dict) -> int:
    """Highest funnel rank this lead has touched, from pipeline_history + current stage."""
    best = FUNNEL_RANK.get(lead.get("stage", ""), -1)
    for h in lead.get("pipeline_history", []) or []:
        best = max(best, FUNNEL_RANK.get(h.get("to_stage", ""), -1))
    return best


def _avg_days_in_stage(leads: list, stage: str) -> float:
    """Average days a lead spent in `stage`, from consecutive pipeline_history timestamps."""
    spans = []
    for lead in leads:
        hist = sorted((lead.get("pipeline_history") or []), key=lambda h: h.get("at", "") or "")
        for i, h in enumerate(hist):
            if h.get("to_stage") != stage:
                continue
            start = h.get("at")
            end = hist[i + 1].get("at") if i + 1 < len(hist) else None
            if not start or not end:
                continue
            try:
                d0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
                d1 = datetime.fromisoformat(end.replace("Z", "+00:00"))
                spans.append((d1 - d0).total_seconds() / 86400)
            except Exception:
                continue
    return round(sum(spans) / len(spans), 1) if spans else 0.0


@router.get("/leads/funnel")
async def leads_funnel(request: Request,
                       start: Optional[str] = None, end: Optional[str] = None,
                       rep: Optional[str] = None, source: Optional[str] = None):
    user = await get_current_user(request)
    team = get_team(user)
    if team in ("accounts", "store"):
        return {"stages": [], "won": {"count": 0, "value": 0}, "lost": {"count": 0}, "lost_reasons": {}}
    query = {} if team == "admin" else {"assigned_to": user["email"]}
    if rep and team == "admin":
        query["assigned_to"] = rep
    if source:
        query["source"] = source
    if start or end:
        cq = {}
        if start:
            cq["$gte"] = start
        if end:
            cq["$lte"] = end + "T23:59:59"
        query["created_at"] = cq
    leads = await db.leads.find(query, {"_id": 0}).to_list(20000)

    # reached counts: a lead counts toward stage S if it reached rank(S) or beyond
    reached = {s: 0 for s in FUNNEL_ORDER}
    for lead in leads:
        top = _max_stage_reached(lead)
        for s in FUNNEL_ORDER:
            if top >= FUNNEL_RANK[s]:
                reached[s] += 1

    stages = []
    prev = None
    for s in FUNNEL_ORDER:
        cnt = reached[s]
        adv = round(cnt / prev * 100, 1) if prev else 100.0
        stages.append({"stage": s, "count": cnt, "advanced_pct": adv,
                       "avg_days": _avg_days_in_stage(leads, s)})
        prev = cnt if cnt else prev

    quote_map = await _build_quote_map(leads)
    won = [l for l in leads if l.get("stage") == "won"]
    won_value = round(sum(resolve_lead_value(l, quote_map) for l in won), 2)
    lost = [l for l in leads if l.get("stage") == "lost"]
    lost_reasons = {}
    for l in lost:
        key = l.get("lost_reason") or "Unspecified"
        lost_reasons[key] = lost_reasons.get(key, 0) + 1

    return {
        "stages": stages,
        "won": {"count": len(won), "value": won_value},
        "lost": {"count": len(lost)},
        "lost_reasons": lost_reasons,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestFunnel -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/crm_routes.py backend/tests/test_crm_phase1.py
git commit -m "feat(crm): conversion funnel endpoint (rates, avg days, lost reasons)"
```

---

## Task 6: Needs-attention compute + endpoint

**Files:**
- Modify: `backend/routes/crm_routes.py` (compute fn near other pure fns; endpoint after `leads_funnel`)
- Test: `backend/tests/test_crm_phase1.py`

- [ ] **Step 1: Write the failing test**

```python
class TestNeedsAttention:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_overdue_and_no_action_flag(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_NA_{uid}", "contact_name": "T",
            "contact_phone": "9000000003", "stage": "contacted",
            "next_followup_date": "2020-01-01",  # long past
        })
        self.lead_id = r.json()["lead_id"]
        a = self.s.get(f"{BASE}/api/leads/needs-attention")
        assert a.status_code == 200, a.text
        rows = a.json()
        mine = next((x for x in rows if x["lead_id"] == self.lead_id), None)
        assert mine is not None, "overdue lead should be flagged"
        assert "overdue" in mine["reasons"]
        assert "no_next_action" in mine["reasons"]  # no followup/task scheduled
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestNeedsAttention -v`
Expected: FAIL — 404 on `/api/leads/needs-attention`.

- [ ] **Step 3: Implement**

Pure function near `calc_lead_score`:

```python
def _parse_dt(val):
    if not val:
        return None
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        try:
            return datetime.fromisoformat(str(val)[:10]).replace(tzinfo=timezone.utc)
        except Exception:
            return None


def compute_attention(lead: dict, now: datetime, settings: dict,
                      has_upcoming: bool, has_open_task: bool) -> list:
    """Return list of reason codes; empty if the lead is fine. Open stages only."""
    if lead.get("stage") not in OPEN_STAGES:
        return []
    reasons = []
    nfd = _parse_dt(lead.get("next_followup_date"))
    if nfd and nfd < now:
        reasons.append("overdue")
    last = _parse_dt(lead.get("last_activity_date"))
    limit = (settings.get("stage_idle_limits") or {}).get(lead.get("stage"), 7)
    if last and (now - last).days >= int(limit or 7):
        reasons.append("stuck")
    if not has_upcoming and not has_open_task:
        reasons.append("no_next_action")
    return reasons
```

Endpoint after `leads_funnel`:

```python
@router.get("/leads/needs-attention")
async def leads_needs_attention(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team in ("accounts", "store"):
        return []
    query = {"stage": {"$in": OPEN_STAGES}}
    if team != "admin":
        query["assigned_to"] = user["email"]
    leads = await db.leads.find(query, {"_id": 0}).to_list(20000)
    lead_ids = [l["lead_id"] for l in leads]
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    settings = await get_crm_settings()

    upcoming = set()
    async for fu in db.followups.find(
        {"lead_id": {"$in": lead_ids}, "status": "pending",
         "followup_date": {"$gte": today}}, {"_id": 0, "lead_id": 1}):
        upcoming.add(fu["lead_id"])
    open_tasks = set()
    async for t in db.tasks.find(
        {"lead_id": {"$in": lead_ids}, "status": "pending"}, {"_id": 0, "lead_id": 1}):
        open_tasks.add(t["lead_id"])

    quote_map = await _build_quote_map(leads)
    out = []
    for lead in leads:
        reasons = compute_attention(
            lead, now, settings,
            lead["lead_id"] in upcoming, lead["lead_id"] in open_tasks)
        if reasons:
            out.append({
                "lead_id": lead["lead_id"],
                "company_name": lead.get("company_name", ""),
                "contact_name": lead.get("contact_name", ""),
                "stage": lead.get("stage", ""),
                "assigned_to": lead.get("assigned_to", ""),
                "assigned_name": lead.get("assigned_name", ""),
                "deal_value": resolve_lead_value(lead, quote_map),
                "reasons": reasons,
            })
    out.sort(key=lambda x: x["deal_value"], reverse=True)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py::TestNeedsAttention -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/crm_routes.py backend/tests/test_crm_phase1.py
git commit -m "feat(crm): needs-attention detection endpoint (overdue/stuck/no-action)"
```

---

## Task 7: Daily digest scheduler job (gated + dry-run)

**Files:**
- Modify: `backend/scheduler.py` (imports near top; new functions before `start_scheduler`; register in `start_scheduler`)
- Test: manual (scheduler loops are not unit-tested in this repo; verify via dry-run log)

- [ ] **Step 1: Add the digest job**

In `scheduler.py`, extend the crm import (add a new import line near the existing `from routes.fms_routes import ...`):

```python
from routes.crm_routes import (
    get_crm_settings, compute_attention, resolve_lead_value,
    _build_quote_map, OPEN_STAGES,
)
```

Add near the other dry-run flag (`FMS_DRY_RUN`):

```python
CRM_DIGEST_DRY_RUN = os.getenv("CRM_DIGEST_DRY_RUN", "0") == "1"
```

Add before `start_scheduler`:

```python
# ══════════════════════════════════════════════════════════════════════════════
# JOB 6 — CRM "Needs Attention" Daily Digest
# ══════════════════════════════════════════════════════════════════════════════

REASON_LABEL = {"overdue": "overdue follow-up", "stuck": "no recent activity",
                "no_next_action": "no next step"}


async def _digest_compute() -> dict:
    """Return {rep_email: [attention rows]} across all open leads."""
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    settings = await get_crm_settings()
    leads = await db.leads.find(
        {"stage": {"$in": OPEN_STAGES}}, {"_id": 0}).to_list(20000)
    lead_ids = [l["lead_id"] for l in leads]
    upcoming, open_tasks = set(), set()
    async for fu in db.followups.find(
        {"lead_id": {"$in": lead_ids}, "status": "pending",
         "followup_date": {"$gte": today}}, {"_id": 0, "lead_id": 1}):
        upcoming.add(fu["lead_id"])
    async for t in db.tasks.find(
        {"lead_id": {"$in": lead_ids}, "status": "pending"}, {"_id": 0, "lead_id": 1}):
        open_tasks.add(t["lead_id"])
    quote_map = await _build_quote_map(leads)
    by_rep = {}
    for lead in leads:
        reasons = compute_attention(lead, now, settings,
                                    lead["lead_id"] in upcoming,
                                    lead["lead_id"] in open_tasks)
        if not reasons:
            continue
        rep = lead.get("assigned_to") or ""
        by_rep.setdefault(rep, []).append({
            "company": lead.get("company_name", ""),
            "value": resolve_lead_value(lead, quote_map),
            "reasons": reasons,
        })
    return by_rep


def _format_rep_digest(rows: list) -> str:
    rows = sorted(rows, key=lambda r: r["value"], reverse=True)
    lines = [f"Good morning! You have {len(rows)} lead(s) needing attention today:"]
    for r in rows[:15]:
        why = ", ".join(REASON_LABEL.get(x, x) for x in r["reasons"])
        val = f" (₹{int(r['value']):,})" if r["value"] else ""
        lines.append(f"• {r['company']}{val} — {why}")
    if len(rows) > 15:
        lines.append(f"…and {len(rows) - 15} more. Open SmartShape CRM to review.")
    return "\n".join(lines)


async def run_crm_digest():
    settings = await get_crm_settings()
    if not settings.get("digest_enabled"):
        log.debug("[digest] disabled — skipping")
        return
    by_rep = await _digest_compute()
    if not by_rep:
        log.info("[digest] nothing to send")
        return
    # per-rep messages
    admin_summary = []
    total_at_risk = 0.0
    for rep_email, rows in by_rep.items():
        at_risk = sum(r["value"] for r in rows)
        total_at_risk += at_risk
        admin_summary.append((rep_email, len(rows), at_risk))
        if not rep_email:
            continue
        recipient = await _resolve_recipient(rep_email)
        text = _format_rep_digest(rows)
        if CRM_DIGEST_DRY_RUN:
            log.info(f"[digest][dry] -> {rep_email}\n{text}")
            continue
        await _fms_send_wa(recipient.get("phone", ""), text)
        await _fms_send_email(recipient.get("email", ""),
                              "SmartShape CRM — leads needing attention", text)
    # admin summary
    admins = await db.users.find({"role": "admin"}, {"_id": 0, "email": 1}).to_list(20)
    summary_lines = ["CRM daily summary — leads needing attention by rep:"]
    for rep_email, n, at_risk in sorted(admin_summary, key=lambda x: x[2], reverse=True):
        summary_lines.append(f"• {rep_email or 'Unassigned'}: {n} leads, ₹{int(at_risk):,} at risk")
    summary_lines.append(f"Total at risk: ₹{int(total_at_risk):,}")
    summary = "\n".join(summary_lines)
    for a in admins:
        if CRM_DIGEST_DRY_RUN:
            log.info(f"[digest][dry] admin -> {a['email']}\n{summary}")
            continue
        r = await _resolve_recipient(a["email"])
        await _fms_send_wa(r.get("phone", ""), summary)
        await _fms_send_email(a["email"], "SmartShape CRM — daily summary", summary)


async def crm_digest_loop():
    log.info("[scheduler] CRM digest loop started")
    while True:
        try:
            settings = await get_crm_settings()
            hhmm = (settings.get("digest_time") or "08:00").split(":")
            hh, mm = int(hhmm[0]), int(hhmm[1])
            now_ist = datetime.now(IST)
            target = now_ist.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if now_ist >= target:
                target += timedelta(days=1)
            sleep_secs = (target - now_ist).total_seconds()
            log.info(f"[digest] next run in {sleep_secs/3600:.1f}h")
            await asyncio.sleep(max(60, sleep_secs))
            await run_crm_digest()
        except Exception as exc:
            log.error(f"[digest loop] {exc}")
            await asyncio.sleep(3600)
```

In `start_scheduler`, add before the final log line:

```python
    asyncio.create_task(crm_digest_loop())
```

And update that log line to `"[scheduler] all 6 background jobs running"`.

- [ ] **Step 2: Verify import + dry-run without sending**

Run (dry-run, will NOT send even if enabled):

```bash
cd backend && CRM_DIGEST_DRY_RUN=1 python -c "import asyncio; from scheduler import run_crm_digest, _digest_compute; print('import OK')"
```

Expected: prints `import OK` (no ImportError). PowerShell equivalent:
`$env:CRM_DIGEST_DRY_RUN=1; python -c "import scheduler; print('import OK')"`

- [ ] **Step 3: Manual dry-run of the computation (safe — read-only, no send)**

```bash
cd backend && CRM_DIGEST_DRY_RUN=1 python -c "import asyncio; from scheduler import _digest_compute; print({k: len(v) for k,v in asyncio.run(_digest_compute()).items()})"
```

Expected: prints a dict of `rep_email -> count`. No messages sent (compute only).

- [ ] **Step 4: Commit**

```bash
git add backend/scheduler.py
git commit -m "feat(crm): daily needs-attention digest (disabled by default, dry-run)"
```

---

## Task 8: Full suite green + frontend API stubs

**Files:**
- Modify: `frontend/src/lib/api.js` (extend the `leads` object ~line 349; add `pipelineSettings`)
- Test: `backend/tests/test_crm_phase1.py` (run all)

- [ ] **Step 1: Run the entire new suite**

Run: `cd backend && python -m pytest tests/test_crm_phase1.py -v`
Expected: ALL PASS (TestPipelineSettings, TestLeadValueEnrichment, TestLostReason, TestForecast, TestFunnel, TestNeedsAttention).

- [ ] **Step 2: Add frontend API bindings (used by the follow-up frontend plan)**

In `frontend/src/lib/api.js`, add to the `leads` object:

```javascript
  forecast: () => API.get('/leads/forecast'),
  funnel: (params) => API.get('/leads/funnel', { params }),
  needsAttention: () => API.get('/leads/needs-attention'),
```

And add a new export near the other masters:

```javascript
export const pipelineSettings = {
  get: () => API.get('/pipeline-settings'),
  update: (data) => API.put('/pipeline-settings', data),
};
```

- [ ] **Step 3: Verify frontend still builds**

Run: `cd frontend && npm run build`
Expected: build succeeds (no syntax errors from the api.js edit).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.js
git commit -m "feat(crm): frontend API bindings for forecast/funnel/needs-attention/settings"
```

---

## Self-Review notes

- **Spec coverage:** deal value (T2/T3) ✓, weighted forecast (T2/T4) ✓, lost reason required (T3) ✓, conversion funnel + avg days + lost-reason breakdown (T5) ✓, needs-attention overdue/stuck/no-action (T6) ✓, daily digest rep+admin, disabled default, dry-run (T7) ✓, admin-tunable settings (T1) ✓, RBAC scoping preserved (T4/T5/T6) ✓, API bindings (T8) ✓.
- **Deferred to frontend plan:** warn-on-stage-change modal, badges, forecast/funnel UI, settings UI, lead form fields. These are UI-only; the data + endpoints they need all exist after this plan.
- **Type consistency:** `resolve_lead_value`, `stage_probability`, `_build_quote_map`, `compute_attention`, `get_crm_settings`, `OPEN_STAGES` defined in `crm_routes.py` and imported by `scheduler.py` with identical names.
- **Route ordering:** `/leads/forecast`, `/leads/funnel`, `/leads/needs-attention` are literal paths added alongside existing literal `/leads/referral-leaderboard`; no `/leads/{lead_id}` GET exists to shadow them.
- **Prod-safety:** all new GETs are read-only; only writes are settings doc + 3 lead fields via explicit user action; digest gated by `digest_enabled` + `CRM_DIGEST_DRY_RUN`.
