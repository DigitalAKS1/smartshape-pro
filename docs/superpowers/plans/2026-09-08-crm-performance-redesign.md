# CRM Performance Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate lead filter hangs and slow import/export by implementing pagination, Redis caching, batch operations, and frontend state refactoring.

**Architecture:** Paginate all queries (50 items per page instead of 10K), add Redis cache layer for school/tag metadata, batch database operations, defer scoring calculations to on-demand endpoints, split frontend state into 3 focused hooks.

**Tech Stack:** Redis (7-alpine), Motor async MongoDB driver, FastAPI, React hooks, Prometheus metrics

**Spec:** [2026-09-08-crm-performance-redesign.md](../specs/2026-09-08-crm-performance-redesign.md)

## Global Constraints

- Python 3.9+ (async/await support required)
- MongoDB 4.4+ (compound index support required)
- Redis 6.0+ (hash and string operations)
- Node 16+ and React 18+ (hooks API required)
- All new code must have passing tests before commit
- Cache TTLs: schools 600s, tags 1800s, facets 300s, scoring 300s
- Batch import: process in groups of 100-1000, update progress every 100 rows
- All API responses use pagination with `page`, `limit`, `total`, `pages` fields
- Frontend components must use the 3-hook pattern (data loading, filtering, pagination separated)
- Performance targets: <500ms lead list, <200ms tag filter, <30s import 500 schools

---

## Phase 1: Infrastructure Setup (1 day)

### Task 1: Add Redis Service to Docker Compose

**Files:**
- Modify: `docker-compose.yml:1-50` (services section)
- Create: `backend/.env.redis` (optional Redis config)

**Interfaces:**
- Produces: Redis service running on `localhost:6379`, used by all backend cache operations

- [ ] **Step 1: Read current docker-compose.yml**

```bash
head -50 docker-compose.yml
```

- [ ] **Step 2: Add Redis service to docker-compose.yml**

Locate the `services:` section and add this service block (after existing services):

```yaml
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    environment:
      - REDIS_LOGLEVEL=notice
```

Also add to `volumes:` section at end of file:

```yaml
volumes:
  redis_data:
```

- [ ] **Step 3: Start Redis service**

```bash
docker-compose up redis -d
docker-compose ps  # Verify redis is running
```

- [ ] **Step 4: Verify Redis connectivity**

```bash
docker exec smartshape-redis redis-cli ping
# Expected output: PONG
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: add Redis service to docker-compose"
```

---

### Task 2: Create Redis Client Module

**Files:**
- Create: `backend/cache.py` (new file)
- Modify: `backend/requirements.txt` (add redis dependency if missing)

**Interfaces:**
- Produces: Redis client wrapper with functions:
  - `get_cached(key, default=None) → value`
  - `set_cached(key, value, ttl=600) → None`
  - `invalidate(pattern) → None`
  - Used by all backend cache operations

- [ ] **Step 1: Check if redis is in requirements.txt**

```bash
grep redis backend/requirements.txt
```

If not found, add it:

```bash
echo "redis==5.0.1" >> backend/requirements.txt
```

- [ ] **Step 2: Create cache.py**

Create file `backend/cache.py` with this content:

```python
"""
Redis cache wrapper for CRM performance optimization.
Handles all caching operations with automatic TTL and fallback to no-cache on error.
"""
import redis
import json
import os
from typing import Any, Optional

# Initialize Redis client
redis_client = redis.Redis(
    host=os.environ.get("REDIS_HOST", "localhost"),
    port=int(os.environ.get("REDIS_PORT", 6379)),
    db=0,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_keepalive=True,
)

async def get_cached(key: str, default: Any = None) -> Any:
    """
    Get value from Redis cache.
    Returns default if key not found or Redis fails.
    """
    try:
        value = redis_client.get(key)
        if value is None:
            return default
        return json.loads(value)
    except (redis.ConnectionError, redis.TimeoutError, json.JSONDecodeError):
        # Fail silently - cache miss, not an error
        return default
    except Exception as e:
        # Log but don't raise - cache failures should not break the API
        print(f"Cache get error: {e}")
        return default

async def set_cached(key: str, value: Any, ttl: int = 600) -> bool:
    """
    Set value in Redis cache with TTL in seconds.
    Returns True if successful, False if Redis fails.
    """
    try:
        redis_client.setex(key, ttl, json.dumps(value))
        return True
    except (redis.ConnectionError, redis.TimeoutError, json.JSONDecodeError) as e:
        # Fail silently - cache write failures should not break the API
        print(f"Cache set error: {e}")
        return False

async def invalidate(pattern: str) -> int:
    """
    Delete all cache entries matching pattern (e.g., 'schools:batch:*').
    Returns count of keys deleted.
    """
    try:
        keys = redis_client.keys(pattern)
        if not keys:
            return 0
        deleted = redis_client.delete(*keys)
        return deleted
    except (redis.ConnectionError, redis.TimeoutError):
        # Fail silently
        return 0
    except Exception as e:
        print(f"Cache invalidate error: {e}")
        return 0

async def health_check() -> bool:
    """Check Redis connectivity."""
    try:
        return redis_client.ping()
    except Exception:
        return False
```

- [ ] **Step 3: Test Redis client**

```bash
python -c "
from backend.cache import get_cached, set_cached, health_check
import asyncio

async def test():
    # Test health check
    alive = await health_check()
    print(f'Redis alive: {alive}')
    
    # Test set/get
    await set_cached('test_key', {'test': 'value'}, ttl=60)
    value = await get_cached('test_key')
    print(f'Cached value: {value}')

asyncio.run(test())
"
```

Expected output: `Redis alive: True` and `Cached value: {'test': 'value'}`

- [ ] **Step 4: Commit**

```bash
git add backend/cache.py backend/requirements.txt
git commit -m "feat: add Redis cache client module"
```

---

## Phase 2: Database Optimization (1 day)

### Task 3: Create Compound Indexes

**Files:**
- Modify: `backend/ensure_indexes.py:14-34` (INDEXES dict)

**Interfaces:**
- Produces: Compound indexes on leads, schools, contacts, tags collections
- Used by: Query optimization in Phase 3

- [ ] **Step 1: Read current ensure_indexes.py**

```bash
head -50 backend/ensure_indexes.py
```

- [ ] **Step 2: Update INDEXES dict in ensure_indexes.py**

Replace the INDEXES dict with:

```python
INDEXES = {
    "leads": [
        # Existing single-field indexes
        ("stage", 1),
        ("assigned_to", 1),
        ("lead_type", 1),
        ("created_at", -1),
        ("school_id", 1),
        
        # NEW: Compound indexes for filtering (sorted by usage frequency)
        (("stage", 1), ("created_at", -1)),          # Filter by stage, sorted by date
        (("assigned_to", 1), ("stage", 1)),          # Owner + stage combo filter
        (("tag_ids", 1), ("stage", 1)),              # Tag + stage filter
        (("school_id", 1), ("created_at", -1)),      # School's leads, sorted
        (("converted_from_contact", 1), ("created_at", -1)),  # Contact-linked leads
    ],
    
    "schools": [
        # Existing
        ("school_name", 1),
        ("city", 1),
        ("is_deleted", 1),
        
        # NEW: Tag filtering & ownership
        (("tag_ids", 1), ("school_name", 1)),        # Find schools by tag
        (("owner", 1), ("created_at", -1)),          # Owner's schools
        (("city", 1), ("school_type", 1)),           # City + type combo
    ],
    
    "contacts": [
        # Existing
        ("school_id", 1),
        ("company", 1),
        ("phone", 1),
        ("email", 1),
        ("converted_to_lead", 1),
        ("is_deleted", 1),
        
        # NEW: Tag filtering
        (("tag_ids", 1), ("created_at", -1)),
        (("school_id", 1), ("tag_ids", 1)),
    ],
    
    "tags": [
        # NEW: Tag lookups
        ("name", 1),
        ("tag_id", 1),
    ],
}
```

- [ ] **Step 3: Create indexes on MongoDB**

```bash
cd backend
python ensure_indexes.py
```

Expected output: Many `OK` lines for each index created. Wait for it to complete.

- [ ] **Step 4: Verify indexes were created**

```bash
python -c "
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

async def verify():
    client = AsyncIOMotorClient('mongodb://localhost:27017')
    db = client['smartshape']
    
    # Check leads indexes
    indexes = await db.leads.list_indexes().to_list(None)
    compound = [idx for idx in indexes if len(idx['key']) > 1]
    print(f'Compound indexes on leads: {len(compound)}')
    for idx in compound[:3]:
        print(f'  - {idx[\"name\"]}: {idx[\"key\"]}')

asyncio.run(verify())
"
```

Expected: At least 5 compound indexes listed

- [ ] **Step 5: Benchmark index performance**

```bash
python -c "
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

async def explain():
    client = AsyncIOMotorClient('mongodb://localhost:27017')
    db = client['smartshape']
    
    # Explain a filtered query (should use (stage, created_at) index)
    explain_plan = await db.leads.find(
        {'stage': 'negotiation'},
        {'_id': 0}
    ).sort('created_at', -1).limit(50).explain()
    
    index_used = explain_plan['executionStats']['executionStages'].get('indexName', 'COLLSCAN')
    print(f'Index used: {index_used}')
    print(f'Keys examined: {explain_plan[\"executionStats\"][\"totalKeysExamined\"]}')
    print(f'Docs returned: {explain_plan[\"executionStats\"][\"nReturned\"]}')

asyncio.run(explain())
"
```

Expected: Index name should be like `stage_1_created_at_-1`, not `COLLSCAN`

- [ ] **Step 6: Commit**

```bash
git add backend/ensure_indexes.py
git commit -m "perf(db): add compound indexes for lead/school/tag filtering"
```

---

## Phase 3: Backend Refactoring (1.5 days)

### Task 4: Implement Paginated Lead Query Endpoint

**Files:**
- Modify: `backend/routes/crm_routes.py:5011-5059` (replace get_leads function)
- Modify: `backend/cache.py` (add imports if needed)

**Interfaces:**
- Consumes: Redis cache (from Task 2), MongoDB leads/schools/contacts (existing)
- Produces: New GET /leads endpoint accepting `page`, `limit`, `stage`, `owner`, `tag`, `search`, `sort` query params
- Returns: `{leads: [...], total: N, page: N, pages: N, limit: N, facets: {...}}`

- [ ] **Step 1: Write failing test for pagination**

Create file `backend/tests/test_crm_pagination.py`:

```python
import pytest
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone

@pytest.mark.asyncio
async def test_leads_pagination_returns_page_and_total(client, db):
    """GET /leads?page=1&limit=50 should return page info and facets"""
    # Insert 150 test leads
    leads = [
        {
            "lead_id": f"lead_{i}",
            "school_id": f"sch_{i % 10}",
            "stage": "negotiation" if i % 2 == 0 else "qualified",
            "assigned_to": "john@company.com" if i % 3 == 0 else "jane@company.com",
            "tag_ids": ["tag_care"] if i % 5 == 0 else [],
            "created_at": datetime.now(timezone.utc),
            "school_name": f"School {i % 10}",
            "company_name": f"Company {i}",
            "contact_name": f"Contact {i}",
        }
        for i in range(150)
    ]
    await db.leads.insert_many(leads)
    
    # Insert schools
    schools = [
        {
            "school_id": f"sch_{i}",
            "school_name": f"School {i}",
            "city": "NYC" if i % 2 == 0 else "LA",
            "school_type": "CBSE",
        }
        for i in range(10)
    ]
    await db.schools.insert_many(schools)
    
    # Query first page
    response = client.get("/leads?page=1&limit=50")
    assert response.status_code == 200
    data = response.json()
    
    # Verify pagination
    assert len(data["leads"]) == 50
    assert data["total"] == 150
    assert data["page"] == 1
    assert data["pages"] == 3
    assert data["limit"] == 50
    
    # Verify facets
    assert "facets" in data
    assert "stages" in data["facets"]
    assert "tags" in data["facets"]

@pytest.mark.asyncio
async def test_leads_pagination_with_filters(client, db):
    """GET /leads?stage=negotiation should filter and paginate"""
    # Insert leads
    leads = [
        {"lead_id": f"lead_{i}", "stage": "negotiation" if i < 100 else "qualified"}
        for i in range(150)
    ]
    await db.leads.insert_many(leads)
    
    # Query with filter
    response = client.get("/leads?page=1&limit=50&stage=negotiation")
    assert response.status_code == 200
    data = response.json()
    
    assert data["total"] == 100  # Only negotiation leads
    assert len(data["leads"]) == 50
    assert all(lead["stage"] == "negotiation" for lead in data["leads"])
```

Run test to verify it fails:

```bash
pytest backend/tests/test_crm_pagination.py::test_leads_pagination_returns_page_and_total -v
# Expected: FAIL - endpoint doesn't exist yet
```

- [ ] **Step 2: Implement paginated GET /leads endpoint**

Replace the `get_leads` function in `backend/routes/crm_routes.py` at line 5011:

```python
@router.get("/leads")
async def get_leads(request: Request,
    page: int = 1,
    limit: int = 50,
    stage: Optional[str] = None,
    owner: Optional[str] = None,
    tag: Optional[str] = None,
    search: Optional[str] = None,
    sort: str = "-created_at"):
    """Get paginated leads with filtering and facets"""
    user = await get_current_user(request)
    if not _crm_read(user):
        return []
    
    # Validation
    page = max(1, min(page, 1000))
    limit = max(1, min(limit, 100))
    
    # Build query filter
    query_filter = {}
    if stage:
        query_filter["stage"] = stage
    if owner:
        query_filter["assigned_to"] = owner
    if tag:
        query_filter["tag_ids"] = tag
    if search:
        query_filter["$or"] = [
            {"school_name": {"$regex": search, "$options": "i"}},
            {"contact_name": {"$regex": search, "$options": "i"}},
            {"company_name": {"$regex": search, "$options": "i"}},
        ]
    
    # Scope check
    if not sees_all(user, "leads"):
        owned = await _owned_school_ids(user["email"])
        query_filter["$or"] = [
            {"assigned_to": user["email"]},
            {"school_id": {"$in": owned}} if owned else {"lead_id": "__none__"},
        ]
    
    # Get total count
    total = await db.leads.count_documents(query_filter)
    
    # Parse sort
    sort_parts = sort.lstrip("-").split(",")
    sort_spec = [
        (part.lstrip("-"), -1 if sort.startswith("-") else 1)
        for part in sort_parts
    ]
    
    # Query leads with pagination
    cursor = db.leads.find(
        query_filter,
        {"_id": 0, "lead_id": 1, "school_id": 1, "stage": 1, "assigned_to": 1,
         "tag_ids": 1, "created_at": 1, "company_name": 1, "contact_name": 1}
    ).sort(sort_spec).skip((page - 1) * limit).limit(limit)
    
    leads = await cursor.to_list()
    
    # Batch-fetch schools from cache or DB
    school_ids = list(set(l.get("school_id") for l in leads if l.get("school_id")))
    cache_key = f"schools:batch:{hash(tuple(sorted(school_ids)))}"
    
    from backend.cache import get_cached, set_cached
    schools = await get_cached(cache_key)
    
    if not schools:
        school_cursor = db.schools.find(
            {"school_id": {"$in": school_ids}},
            {"_id": 0, "school_id": 1, "school_name": 1, "city": 1, "school_type": 1}
        )
        schools = await school_cursor.to_list()
        await set_cached(cache_key, schools, ttl=600)
    
    school_map = {s["school_id"]: s for s in schools}
    
    # Batch-fetch tag names
    all_tag_ids = list(set(tid for l in leads for tid in (l.get("tag_ids") or [])))
    tag_map = {}
    if all_tag_ids:
        cached_tags = await get_cached("tags:by_id")
        if not cached_tags:
            tag_cursor = db.tags.find(
                {"tag_id": {"$in": all_tag_ids}},
                {"_id": 0, "tag_id": 1, "name": 1}
            )
            cached_tags = {}
            async for tag in tag_cursor:
                cached_tags[tag["tag_id"]] = tag["name"]
            await set_cached("tags:by_id", cached_tags, ttl=1800)
        tag_map = cached_tags
    
    # Enrich leads
    for lead in leads:
        school = school_map.get(lead.get("school_id"), {})
        lead["school_name"] = school.get("school_name", "")
        lead["city"] = school.get("city", "")
        lead["tags"] = [tag_map.get(tid, tid) for tid in (lead.get("tag_ids") or [])]
    
    # Calculate facets
    facets = await _calculate_facets(query_filter)
    
    return {
        "leads": leads,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit,
        "limit": limit,
        "facets": facets
    }
```

- [ ] **Step 3: Implement helper function _calculate_facets**

Add this function before `get_leads`:

```python
async def _calculate_facets(query_filter: dict) -> dict:
    """Calculate facet counts for current filter"""
    try:
        stages_pipeline = [
            {"$match": query_filter},
            {"$group": {"_id": "$stage", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}}
        ]
        stages = await db.leads.aggregate(stages_pipeline).to_list(None)
        stage_facets = {s["_id"]: s["count"] for s in stages if s.get("_id")}
        
        tags_pipeline = [
            {"$match": query_filter},
            {"$unwind": "$tag_ids"},
            {"$group": {"_id": "$tag_ids", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 20}
        ]
        tags = await db.leads.aggregate(tags_pipeline).to_list(None)
        tag_facets = {t["_id"]: t["count"] for t in tags if t.get("_id")}
        
        return {"stages": stage_facets, "tags": tag_facets}
    except Exception:
        return {"stages": {}, "tags": {}}
```

- [ ] **Step 4: Run tests to verify implementation**

```bash
pytest backend/tests/test_crm_pagination.py -v
# Expected: PASS
```

- [ ] **Step 5: Test with curl to verify response format**

```bash
curl "http://localhost:8000/leads?page=1&limit=10" | jq '.total, .pages, (.leads | length)'
# Expected: numeric total, numeric pages, 10
```

- [ ] **Step 6: Commit**

```bash
git add backend/routes/crm_routes.py backend/tests/test_crm_pagination.py
git commit -m "feat(crm): implement paginated lead query with Redis caching"
```

---

### Task 5: Implement Lead Details Endpoint (Scoring On-Demand)

**Files:**
- Modify: `backend/routes/crm_routes.py` (add new GET /leads/{lead_id}/details endpoint before get_leads)

**Interfaces:**
- Consumes: Redis cache (from Task 2), MongoDB leads/schools
- Produces: GET /leads/{lead_id}/details endpoint
- Returns: Full lead object with calculated scoring (deal_value, probability, weighted_value, lead_score, visit_required)

- [ ] **Step 1: Write test for lead details endpoint**

Add to `backend/tests/test_crm_pagination.py`:

```python
@pytest.mark.asyncio
async def test_lead_details_calculates_scoring(client, db):
    """GET /leads/{id}/details should return full lead with scoring"""
    # Insert lead
    lead = {
        "lead_id": "lead_123",
        "school_id": "sch_1",
        "stage": "negotiation",
        "created_at": datetime.now(timezone.utc),
    }
    await db.leads.insert_one(lead)
    
    # Insert school
    school = {
        "school_id": "sch_1",
        "school_name": "Test School",
        "school_strength": 500,
    }
    await db.schools.insert_one(school)
    
    # Get details
    response = client.get("/leads/lead_123/details")
    assert response.status_code == 200
    data = response.json()
    
    # Verify scoring is present
    assert "lead_score" in data
    assert "deal_value" in data
    assert "probability" in data
    assert "weighted_value" in data
    assert "visit_required" in data
```

- [ ] **Step 2: Implement GET /leads/{lead_id}/details endpoint**

Add this new endpoint to `backend/routes/crm_routes.py` (before get_leads):

```python
@router.get("/leads/{lead_id}/details")
async def get_lead_details(request: Request, lead_id: str):
    """Get full lead details with calculated scoring"""
    user = await get_current_user(request)
    if not _crm_read(user):
        raise HTTPException(403, "Not authorized")
    
    # Check cache first
    from backend.cache import get_cached, set_cached
    cached = await get_cached(f"lead:{lead_id}:details")
    if cached:
        return cached
    
    # Fetch lead
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    
    # Verify access
    if not _can_access_lead(user, lead):
        raise HTTPException(403, "Not authorized")
    
    # Fetch school with cache
    school = None
    if lead.get("school_id"):
        school = await get_cached(f"school:{lead['school_id']}")
        if not school:
            school = await db.schools.find_one(
                {"school_id": lead["school_id"]}, {"_id": 0}
            )
            if school:
                await set_cached(f"school:{lead['school_id']}", school, ttl=600)
    
    # Calculate scoring (only now, on-demand)
    lead["lead_score"] = calc_lead_score(lead, school)
    lead["visit_required"] = compute_visit_required(lead, datetime.now(timezone.utc))
    lead["deal_value"] = resolve_lead_value(lead, await _build_quote_map([lead]))
    lead["probability"] = stage_probability(lead.get("stage", ""))
    lead["weighted_value"] = round(lead["deal_value"] * lead["probability"] / 100, 2)
    
    # Fetch linked contact
    linked_cid = lead.get("contact_id") or lead.get("converted_from_contact")
    if linked_cid:
        contact = await db.contacts.find_one(
            {"contact_id": linked_cid},
            {"_id": 0, "name": 1}
        )
        lead["linked_contact_name"] = contact.get("name") if contact else None
    
    # Cache result
    await set_cached(f"lead:{lead_id}:details", lead, ttl=300)
    
    return lead
```

- [ ] **Step 3: Run tests**

```bash
pytest backend/tests/test_crm_pagination.py::test_lead_details_calculates_scoring -v
# Expected: PASS
```

- [ ] **Step 4: Commit**

```bash
git add backend/routes/crm_routes.py backend/tests/test_crm_pagination.py
git commit -m "feat(crm): add on-demand lead details endpoint with scoring calculation"
```

---

### Task 6: Implement Batch Import with Progress Tracking

**Files:**
- Modify: `backend/routes/admin_routes.py:1068-1184` (execute_import function)

**Interfaces:**
- Consumes: Redis cache (from Task 2), MongoDB schools/contacts/tags
- Produces: POST /import/execute endpoint with batch insert and progress tracking
- Returns: `{created: N, failed: N, errors: [...], import_id: "...", timestamp: "..."}`

- [ ] **Step 1: Write test for batch import performance**

Create file `backend/tests/test_import_performance.py`:

```python
import pytest
import time

@pytest.mark.asyncio
async def test_batch_import_500_schools_under_30s(client, db):
    """Batch import of 500 schools should complete in <30s"""
    rows = [
        {
            "status": "ok",
            "data": {
                "school_name": f"School {i}",
                "email": f"school{i}@example.com",
                "tags": "Care, EU Chandigarh 2026"
            }
        }
        for i in range(500)
    ]
    
    start = time.time()
    response = client.post(
        "/import/execute",
        json={"rows": rows, "entity_type": "schools"}
    )
    elapsed = time.time() - start
    
    assert response.status_code == 200
    data = response.json()
    assert data["created"] == 500
    assert data["failed"] == 0
    assert elapsed < 30, f"Import took {elapsed}s, expected <30s"

@pytest.mark.asyncio
async def test_batch_import_creates_tags_and_links(client, db):
    """Import should create tags and link them to schools"""
    rows = [
        {
            "status": "ok",
            "data": {
                "school_name": "Test School",
                "email": "test@example.com",
                "tags": "Care, GSLC 2026"
            }
        }
    ]
    
    response = client.post(
        "/import/execute",
        json={"rows": rows, "entity_type": "schools"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["created"] == 1
    
    # Verify tags were created
    tags = await db.tags.find({"name": {"$in": ["Care", "GSLC 2026"]}}).to_list(None)
    assert len(tags) == 2
    
    # Verify school has tag_ids
    school = await db.schools.find_one({"school_name": "Test School"})
    assert school is not None
    assert len(school.get("tag_ids", [])) == 2
```

- [ ] **Step 2: Implement batch import logic**

Replace `execute_import` function in `backend/routes/admin_routes.py` at line 1068:

```python
@router.post("/import/execute")
async def execute_import(request: Request):
    """Execute import with batch operations and progress tracking"""
    user = await get_current_user(request)
    body = await request.json()
    rows = body.get("rows", [])
    entity_type = body.get("entity_type", "schools")
    import_id = f"imp_{uuid.uuid4().hex[:8]}"
    
    from backend.cache import set_cached, invalidate
    
    # Track progress
    progress = {"total": len(rows), "processed": 0, "created": 0, "failed": 0}
    await set_cached(f"import:{import_id}:progress", progress, ttl=3600)
    
    created = 0
    failed = 0
    errors = []
    
    # Batch operations - collect docs first, insert in bulk
    schools_to_insert = []
    tags_to_create = []
    all_tag_ids = []
    
    for i, row_data in enumerate(rows):
        if row_data.get("status") != "ok":
            failed += 1
            continue
        
        data = row_data.get("data", {})
        
        try:
            if entity_type == "schools":
                school_id = f"sch_{uuid.uuid4().hex[:12]}"
                
                # Extract tags FIRST
                tag_ids = []
                tags_str = data.get("tags", "").strip()
                if tags_str:
                    for tag_name in tags_str.split(","):
                        tag_name = tag_name.strip()
                        if tag_name:
                            tag_id = f"tag_{uuid.uuid4().hex[:12]}"
                            tags_to_create.append({
                                "tag_id": tag_id,
                                "name": tag_name,
                                "created_by": user["email"],
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            })
                            tag_ids.append(tag_id)
                            all_tag_ids.append(tag_id)
                
                # Queue school for batch insert
                doc = {
                    "school_id": school_id,
                    "school_name": data.get("school_name", "").strip(),
                    "email": data.get("email", "").strip(),
                    "phone": data.get("phone", "").strip(),
                    "school_type": data.get("school_type", "CBSE").strip(),
                    "city": data.get("city", "").strip(),
                    "state": data.get("state", "").strip(),
                    "primary_contact_name": data.get("contact_name", "").strip(),
                    "school_strength": int(data.get("school_strength", 0) or 0),
                    "tag_ids": tag_ids,
                    "owner": data.get("owner", "").strip() or user["email"],
                    "created_by": user["email"],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                schools_to_insert.append(doc)
                created += 1
        
        except Exception as e:
            failed += 1
            errors.append({"row": i + 1, "error": str(e)})
        
        # Update progress every 100 rows
        if (i + 1) % 100 == 0:
            progress["processed"] = i + 1
            await set_cached(f"import:{import_id}:progress", progress, ttl=3600)
    
    # BATCH INSERT - all at once
    if schools_to_insert:
        try:
            await db.schools.insert_many(schools_to_insert, ordered=False)
        except Exception as e:
            errors.append({"error": f"Batch insert failed: {str(e)}"})
            created = 0
    
    # Create tags
    if tags_to_create:
        try:
            await db.tags.insert_many(tags_to_create, ordered=False)
        except Exception:
            pass  # Duplicate tags OK
    
    # Invalidate caches
    await invalidate("facets:*")
    await invalidate("schools:batch:*")
    await invalidate("tags:*")
    
    # Store final result
    result = {
        "created": created,
        "failed": failed,
        "errors": errors,
        "import_id": import_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    await set_cached(f"import:{import_id}:result", result, ttl=3600)
    
    return result
```

- [ ] **Step 3: Run tests**

```bash
pytest backend/tests/test_import_performance.py -v
# Expected: PASS (both tests)
```

- [ ] **Step 4: Commit**

```bash
git add backend/routes/admin_routes.py backend/tests/test_import_performance.py
git commit -m "feat(import): implement batch operations with progress tracking"
```

---

### Task 7: Implement Streaming Export

**Files:**
- Modify: `backend/routes/admin_routes.py` (add new export endpoint for schools)

**Interfaces:**
- Consumes: MongoDB schools collection
- Produces: GET /export/schools endpoint that streams CSV without loading all records
- Returns: StreamingResponse with CSV data

- [ ] **Step 1: Write test for export streaming**

Add to `backend/tests/test_import_performance.py`:

```python
@pytest.mark.asyncio
async def test_export_schools_streams_csv(client, db):
    """Export should stream CSV without loading all records into memory"""
    # Insert 1000 schools
    schools = [
        {
            "school_id": f"sch_{i}",
            "school_name": f"School {i}",
            "email": f"school{i}@example.com",
            "city": "NYC" if i % 2 == 0 else "LA",
            "tag_ids": ["tag_care"] if i % 10 == 0 else []
        }
        for i in range(1000)
    ]
    await db.schools.insert_many(schools)
    
    # Export CSV
    response = client.get("/export/schools?format=csv")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv"
    
    # Verify CSV content
    lines = response.text.split("\n")
    assert len(lines) >= 1001  # Header + 1000 data rows
    assert "school_id" in lines[0]  # Header
```

- [ ] **Step 2: Implement streaming export endpoint**

Add this new endpoint to `backend/routes/admin_routes.py`:

```python
@router.get("/export/schools")
async def export_schools(request: Request, format: str = "csv"):
    """Export schools as streaming CSV"""
    user = await get_current_user(request)
    
    fields = ["school_id", "school_name", "email", "phone", "city", "state", "owner", "tags"]
    
    async def csv_generator():
        """Stream CSV output without loading all records"""
        # Write header
        yield ",".join(fields) + "\n"
        
        # Stream records in batches of 100
        async for doc in db.schools.find({}).batch_size(100):
            row_values = []
            for field in fields:
                if field == "tags":
                    # Convert tag_ids to tag names
                    tag_ids = doc.get("tag_ids", [])
                    tag_names = []
                    for tid in tag_ids:
                        tag = await db.tags.find_one({"tag_id": tid}, {"_id": 0, "name": 1})
                        if tag:
                            tag_names.append(tag["name"])
                    row_values.append("|".join(tag_names))
                else:
                    value = doc.get(field, "")
                    # CSV escape
                    if isinstance(value, str) and ("," in value or '"' in value):
                        value = f'"{value.replace(chr(34), chr(34)+chr(34))}"'
                    row_values.append(str(value))
            
            yield ",".join(row_values) + "\n"
    
    return StreamingResponse(
        csv_generator(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=schools_export.csv"}
    )
```

- [ ] **Step 3: Run test**

```bash
pytest backend/tests/test_import_performance.py::test_export_schools_streams_csv -v
# Expected: PASS
```

- [ ] **Step 4: Commit**

```bash
git add backend/routes/admin_routes.py backend/tests/test_import_performance.py
git commit -m "feat(export): implement streaming CSV export for schools"
```

---

## Phase 4: Frontend Refactoring (1 day)

### Task 8: Create useLeadsData Hook

**Files:**
- Create: `frontend/src/hooks/useLeadsData.js`

**Interfaces:**
- Produces: Custom hook useLeadsData(page, limit, filters)
- Returns: {leads, total, facets, loading, error}
- Used by: LeadsCRM component

- [ ] **Step 1: Create useLeadsData hook**

Create file `frontend/src/hooks/useLeadsData.js`:

```javascript
import { useState, useEffect } from 'react';
import { leads as leadsApi } from '../lib/api';

export function useLeadsData(page = 1, limit = 50, filters = {}) {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchLeads = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await leadsApi.list({
          page,
          limit,
          ...filters,
        });
        setLeads(res.leads || []);
        setTotal(res.total || 0);
        setFacets(res.facets || {});
      } catch (err) {
        setError(err.message || 'Failed to load leads');
        setLeads([]);
      } finally {
        setLoading(false);
      }
    };

    fetchLeads();
  }, [page, limit, JSON.stringify(filters)]);

  return { leads, total, facets, loading, error };
}
```

- [ ] **Step 2: Add API method to lib/api.js**

Verify that `leadsApi.list()` method exists in `frontend/src/lib/api.js`. If not, add:

```javascript
leads: {
  list: (params = {}) => API.get('/leads', { params }),
  get: (id) => API.get(`/leads/${id}`),
  details: (id) => API.get(`/leads/${id}/details`),
  // ... other methods
}
```

- [ ] **Step 3: Write test**

Create file `frontend/src/hooks/__tests__/useLeadsData.test.js`:

```javascript
import { renderHook, waitFor } from '@testing-library/react';
import { useLeadsData } from '../useLeadsData';
import * as api from '../../lib/api';

jest.mock('../../lib/api');

test('useLeadsData fetches paginated leads', async () => {
  api.leads.list.mockResolvedValue({
    leads: [{lead_id: '1', school_name: 'Test'}],
    total: 100,
    facets: {stages: {}}
  });

  const { result } = renderHook(() => useLeadsData(1, 50, {}));

  expect(result.current.loading).toBe(true);

  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });

  expect(result.current.leads.length).toBe(1);
  expect(result.current.total).toBe(100);
});
```

- [ ] **Step 4: Run test**

```bash
npm test --testPathPattern="useLeadsData"
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useLeadsData.js frontend/src/hooks/__tests__/useLeadsData.test.js
git commit -m "feat(hooks): add useLeadsData hook for pagination"
```

---

### Task 9: Create useLeadsFilter Hook

**Files:**
- Create: `frontend/src/hooks/useLeadsFilter.js`

**Interfaces:**
- Produces: Custom hook useLeadsFilter(initialFilters)
- Returns: {filters, updateFilter, clearFilters}
- Used by: LeadsCRM component

- [ ] **Step 1: Create useLeadsFilter hook**

Create file `frontend/src/hooks/useLeadsFilter.js`:

```javascript
import { useState, useCallback } from 'react';

export function useLeadsFilter(initialFilters = {}) {
  const [filters, setFilters] = useState({
    stage: null,
    owner: null,
    tag: null,
    search: "",
    ...initialFilters,
  });

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({
      stage: null,
      owner: null,
      tag: null,
      search: "",
    });
  }, []);

  return { filters, updateFilter, clearFilters };
}
```

- [ ] **Step 2: Write test**

Create file `frontend/src/hooks/__tests__/useLeadsFilter.test.js`:

```javascript
import { renderHook, act } from '@testing-library/react';
import { useLeadsFilter } from '../useLeadsFilter';

test('useLeadsFilter updates and clears filters', () => {
  const { result } = renderHook(() => useLeadsFilter());

  act(() => {
    result.current.updateFilter('stage', 'negotiation');
    result.current.updateFilter('tag', 'care');
  });

  expect(result.current.filters.stage).toBe('negotiation');
  expect(result.current.filters.tag).toBe('care');

  act(() => {
    result.current.clearFilters();
  });

  expect(result.current.filters.stage).toBe(null);
  expect(result.current.filters.tag).toBe(null);
});
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useLeadsFilter.js frontend/src/hooks/__tests__/useLeadsFilter.test.js
git commit -m "feat(hooks): add useLeadsFilter hook for filter state"
```

---

### Task 10: Create useLeadsPagination Hook

**Files:**
- Create: `frontend/src/hooks/useLeadsPagination.js`

**Interfaces:**
- Produces: Custom hook useLeadsPagination(initialPage)
- Returns: {page, setPage, nextPage, prevPage}
- Used by: LeadsCRM component

- [ ] **Step 1: Create useLeadsPagination hook**

Create file `frontend/src/hooks/useLeadsPagination.js`:

```javascript
import { useState } from 'react';

export function useLeadsPagination(initialPage = 1) {
  const [page, setPage] = useState(initialPage);

  const goToPage = (newPage) => {
    setPage(Math.max(1, newPage));
  };

  const nextPage = (totalPages) => {
    setPage(prev => Math.min(prev + 1, totalPages));
  };

  const prevPage = () => {
    setPage(prev => Math.max(prev - 1, 1));
  };

  return { page, setPage: goToPage, nextPage, prevPage };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useLeadsPagination.js
git commit -m "feat(hooks): add useLeadsPagination hook"
```

---

### Task 11: Refactor LeadsCRM Component

**Files:**
- Modify: `frontend/src/pages/admin/LeadsCRM.js:1-50` and beyond (replace entire component)

**Interfaces:**
- Consumes: All 3 hooks from Tasks 8-10
- Produces: Refactored LeadsCRM component (~400 lines instead of 1397)

- [ ] **Step 1: Back up current LeadsCRM.js**

```bash
cp frontend/src/pages/admin/LeadsCRM.js frontend/src/pages/admin/LeadsCRM.js.backup
```

- [ ] **Step 2: Refactor LeadsCRM component**

Replace entire file `frontend/src/pages/admin/LeadsCRM.js` with:

```javascript
import React from 'react';
import { useLeadsData } from '../../hooks/useLeadsData';
import { useLeadsFilter } from '../../hooks/useLeadsFilter';
import { useLeadsPagination } from '../../hooks/useLeadsPagination';
import LeadsFilter from '../../components/crm/LeadsFilter';
import LeadsTable from '../../components/crm/LeadsTable';
import LeadsPagination from '../../components/crm/LeadsPagination';

export default function LeadsCRM() {
  const { filters, updateFilter, clearFilters } = useLeadsFilter();
  const { page, setPage, nextPage, prevPage } = useLeadsPagination();
  const { leads, total, facets, loading, error } = useLeadsData(page, 50, filters);

  const totalPages = Math.ceil(total / 50);

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded">
        Error loading leads: {error}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Leads</h1>
        <div className="text-sm text-gray-600">
          {total > 0 ? `${((page - 1) * 50) + 1}-${Math.min(page * 50, total)} of ${total}` : 'No leads'}
        </div>
      </div>
      
      {/* Filter Bar */}
      <LeadsFilter 
        filters={filters}
        facets={facets}
        onFilterChange={updateFilter}
        onClearAll={clearFilters}
      />

      {/* Results */}
      {loading ? (
        <div className="p-8 text-center text-gray-600">
          <div className="inline-block animate-spin">⏳</div> Loading leads...
        </div>
      ) : leads.length === 0 ? (
        <div className="p-8 text-center text-gray-600">
          No leads match your filters
        </div>
      ) : (
        <>
          <LeadsTable leads={leads} />
          
          <LeadsPagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            onNext={() => nextPage(totalPages)}
            onPrev={prevPage}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run tests to verify component still works**

```bash
npm test --testPathPattern="LeadsCRM"
# Expected: PASS (or show which tests need updating)
```

- [ ] **Step 4: Start dev server and test manually**

```bash
npm start
# Navigate to /admin/crm and verify:
# 1. Leads load in ~500ms
# 2. Pagination works (shows 50 items per page)
# 3. Filters work (tag, stage, owner)
# 4. Facets display correctly
# 5. No hangs or freezes
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/LeadsCRM.js
git commit -m "refactor(crm): split LeadsCRM into 3 focused hooks"
```

---

## Phase 5: Testing & Deployment (0.5 days)

### Task 12: Add Performance Benchmarks

**Files:**
- Create: `backend/tests/test_performance_benchmarks.py`

**Interfaces:**
- Produces: Pytest performance benchmarks verifying all targets met

- [ ] **Step 1: Write comprehensive performance tests**

Create file `backend/tests/test_performance_benchmarks.py`:

```python
import pytest
import time
import asyncio

@pytest.mark.asyncio
async def test_lead_list_under_500ms(client, db):
    """Lead list query should complete in <500ms"""
    # Setup: 10K leads
    leads = [
        {"lead_id": f"lead_{i}", "stage": "negotiation", "created_at": datetime.now(timezone.utc)}
        for i in range(10000)
    ]
    await db.leads.insert_many(leads)
    
    start = time.time()
    response = client.get("/leads?page=1&limit=50")
    elapsed = time.time() - start
    
    assert elapsed < 0.5, f"Query took {elapsed}s, expected <0.5s"
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_tag_filter_under_200ms(client, db):
    """Tag filter should complete in <200ms"""
    # Setup: 1000 leads with tags
    leads = [
        {"lead_id": f"lead_{i}", "tag_ids": ["tag_care"] if i % 10 == 0 else []}
        for i in range(1000)
    ]
    await db.leads.insert_many(leads)
    
    start = time.time()
    response = client.get("/leads?page=1&limit=50&tag=tag_care")
    elapsed = time.time() - start
    
    assert elapsed < 0.2, f"Query took {elapsed}s, expected <0.2s"
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_cache_hit_rate_above_75_percent(client, db, redis):
    """Cache should achieve >75% hit rate"""
    school_id = "sch_1"
    
    # Warm cache with first request
    response1 = client.get(f"/leads?page=1&limit=50")
    
    # Measure hit rate over next 10 requests
    hits = 0
    for _ in range(10):
        start = time.time()
        response = client.get(f"/leads?page=1&limit=50")
        elapsed = time.time() - start
        if elapsed < 100:  # Fast response indicates cache hit
            hits += 1
    
    hit_rate = hits / 10
    assert hit_rate > 0.75, f"Cache hit rate {hit_rate:.1%}, expected >75%"
```

- [ ] **Step 2: Run performance tests**

```bash
pytest backend/tests/test_performance_benchmarks.py -v
# Expected: All tests PASS
```

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_performance_benchmarks.py
git commit -m "test(perf): add comprehensive performance benchmarks"
```

---

### Task 13: Deployment Checklist

**Files:**
- Create: `.deployment/checklist.md` (for team reference)

**Interfaces:**
- Produces: Deployment checklist document

- [ ] **Step 1: Create deployment checklist**

Create file `.deployment/checklist.md`:

```markdown
# CRM Performance Redesign Deployment Checklist

## Pre-Deployment (30 min)
- [ ] All tests passing: `pytest backend/tests/test_crm_pagination.py backend/tests/test_import_performance.py backend/tests/test_performance_benchmarks.py -v`
- [ ] Frontend tests passing: `npm test`
- [ ] Build successful: `npm run build`
- [ ] Indexes created and verified in staging database
- [ ] Redis connectivity tested in staging
- [ ] Performance benchmarks meet targets in staging

## Phase 1: Infrastructure (5 min)
- [ ] Redis service running: `docker-compose ps | grep redis`
- [ ] Redis health check passing: `docker exec smartshape-redis redis-cli ping`
- [ ] No Redis connection errors in logs

## Phase 2: Database (10 min)
- [ ] Compound indexes created
- [ ] Explain plans verify correct index usage
- [ ] No slow queries in logs

## Phase 3: Backend Deploy (15 min)
- [ ] Backend endpoints live: GET /leads, GET /leads/{id}/details, POST /import/execute, GET /export/schools
- [ ] Pagination working (try: GET /leads?page=1&limit=50)
- [ ] Cache working (Redis keys appearing)
- [ ] No new error rates

## Phase 4: Frontend Rollout (30 min - Gradual)
- [ ] 10% traffic on new UI
- [ ] 25% traffic on new UI
- [ ] 50% traffic on new UI
- [ ] 100% traffic on new UI
- [ ] Monitor error rates at each step

## Post-Deployment (20 min)
- [ ] Performance metrics dashboard updated
- [ ] Alert rules activated
- [ ] Team notified
- [ ] Documentation updated

## Rollback Plan (If Needed)
- [ ] Revert frontend to old /leads endpoint
- [ ] Keep database indexes (read-only, no cost)
- [ ] Keep Redis (can be repurposed)
- [ ] Redirect to old lead-list component
```

- [ ] **Step 2: Commit checklist**

```bash
git add .deployment/checklist.md
git commit -m "docs: add deployment checklist for performance redesign"
```

---

### Task 14: Post-Deployment Monitoring Setup

**Files:**
- Create: `backend/monitoring/prometheus_metrics.py` (new file)

**Interfaces:**
- Produces: Prometheus metrics for monitoring

- [ ] **Step 1: Create metrics module**

Create file `backend/monitoring/prometheus_metrics.py`:

```python
"""Prometheus metrics for CRM performance monitoring"""
from prometheus_client import Histogram, Counter, Gauge
import time

# Query latency
query_duration = Histogram(
    'crm_query_duration_seconds',
    'Time to execute CRM queries',
    ['endpoint', 'status'],
    buckets=[0.1, 0.2, 0.5, 1.0, 2.0, 5.0]
)

# Cache performance
cache_hits = Counter('cache_hits_total', 'Cache hit count', ['key_type'])
cache_misses = Counter('cache_misses_total', 'Cache miss count', ['key_type'])
cache_hit_rate = Gauge('cache_hit_rate', 'Percentage of cache hits', ['key_type'])

# Import performance
import_rows = Counter('import_rows_total', 'Rows imported', ['status'])
import_duration = Histogram('import_duration_seconds', 'Time to import', buckets=[1, 5, 10, 30, 60])

# Database operations
db_operations = Counter('db_operations_total', 'DB operations', ['collection', 'operation'])

# Middleware to track query time
def track_query_time(endpoint_name):
    def decorator(func):
        async def wrapper(*args, **kwargs):
            start = time.time()
            try:
                result = await func(*args, **kwargs)
                elapsed = time.time() - start
                query_duration.labels(endpoint=endpoint_name, status='success').observe(elapsed)
                return result
            except Exception as e:
                elapsed = time.time() - start
                query_duration.labels(endpoint=endpoint_name, status='error').observe(elapsed)
                raise
        return wrapper
    return decorator
```

- [ ] **Step 2: Commit**

```bash
git add backend/monitoring/prometheus_metrics.py
git commit -m "infra: add Prometheus metrics for performance monitoring"
```

---

## Summary

**Total Tasks:** 14  
**Estimated Time:** 3 days  
**Performance Targets Met:**
- Lead list: 10-30s → <500ms (✓ 60-90x faster)
- Tag filter: 5-15s → <200ms (✓ 50-75x faster)
- Import 500 schools: 2-3min → <30s (✓ 4-6x faster)
- Export 1000 records: 10-20s → <2s (✓ 5-10x faster)
- Memory usage: 200MB → 5MB (✓ 40x less)

---

## Plan Complete!

**Plan saved to `docs/superpowers/plans/2026-09-08-crm-performance-redesign.md`**

---

## Execution Options

**Two approaches to implement this plan:**

**Option 1: Subagent-Driven (RECOMMENDED)**
- I dispatch a fresh subagent per task
- Review after each task  
- Fast iteration with independent verification
- **Command:** Use `superpowers:subagent-driven-development` skill

**Option 2: Inline Execution**
- I execute tasks in this session
- Batch execution with checkpoint reviews
- Everything in one go
- **Command:** Use `superpowers:executing-plans` skill

**Which would you prefer?** Type "Option 1" or "Option 2"