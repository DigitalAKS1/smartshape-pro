# CRM Export/Import/Filtering System - Complete Performance Redesign

**Date:** 2026-09-08  
**Status:** APPROVED FOR IMPLEMENTATION  
**Priority:** CRITICAL (System hangs on lead filter, import/export slow)  
**Performance Target:** 60-90x faster queries, <500ms lead list load

---

## Executive Summary

The current CRM system has **4 critical bottlenecks** causing user-facing hangs:

1. **Lead Query N+1 Problem**: Loads 10,000 records from DB, then loops querying school data for each
2. **Frontend State Bloat**: useLeadsCRM hook is 803 lines, mixing data/filter/UI concerns
3. **Missing Compound Indexes**: Tag filters run without optimized DB indexes
4. **No Caching Layer**: Repeated expensive queries (school data, tag metadata, scoring)

**Solution**: Pagination + Redis caching + Frontend refactor + Batch operations

**Expected Outcomes**:
- Lead list: 10-30s → <500ms (60-90x faster)
- Tag filters: 5-15s → <200ms (50-75x faster)
- Import 500 schools: 2-3min → <30s (4-6x faster)
- Export 1000 records: 10-20s → <2s (5-10x faster)
- Memory usage: 200MB → 5MB (40x less)

---

## Architecture Overview

### Current (Broken) Flow

```
GET /leads (no pagination)
  ↓
db.leads.find({}).to_list(10000)  ← Load ALL records into memory
  ↓
for lead in 10000:                 ← Loop through each
  db.schools.find_one()            ← N+1 queries! (one per lead)
  calc_lead_score()                ← CPU-heavy (10ms per lead = 100s)
  calc_value()
  calc_probability()
  ↓
Return 10,000 enriched records JSON (200MB payload)
  ↓
Frontend receives → React re-renders all 10,000 items → HANG
```

**Problems**:
- 10-30s backend latency
- 200MB memory spike
- Frontend hangs on render
- No pagination means "view more" requires re-fetching everything

---

### New (Optimized) Flow

```
GET /leads?page=1&limit=50&stage=negotiation&owner=john@company.com
  ↓
Parse page/limit/filters (validation)
  ↓
db.leads.find({stage: "negotiation", assigned_to: "john@..."})
  .sort("created_at", -1)
  .skip((page-1)*50)
  .limit(50)                       ← Only 50 records!
  ↓
Batch-fetch schools in ONE query:
  school_ids = [s1, s2, ..., s50]
  db.schools.find({"school_id": {$in: school_ids}})  ← 1 query, not 50!
  ↓
Use Redis cache for school data (600s TTL):
  schools = await redis.get("schools:batch:{hash}")
  if miss: fetch from DB, cache result
  ↓
Return LEAN leads without scoring:
  {
    leads: [{lead_id, school_name, stage, assigned_to, tags, ...}],
    total: 5432,
    page: 1,
    pages: 109,
    facets: {stages: {...}, tags: {...}, owners: {...}}
  }
  ↓
Frontend renders 50 items → FAST (~200ms)
  ↓
User clicks lead → GET /leads/{id}/details
  ↓
Calculate expensive scoring on-demand (only for 1 lead):
  score = calc_lead_score(lead, school)   ← 10ms for 1 lead
  value = resolve_lead_value(lead)
  probability = stage_probability(lead)
  weighted_value = score * value
  ↓
Cache result in Redis (300s TTL)
  ↓
Return detailed lead with scores
```

**Benefits**:
- <500ms response time (pagination)
- 1-2MB payload (50 items, not 10K)
- Frontend renders instantly
- Scoring only calculated when needed

---

## 1. Database Layer Optimization

### 1.1 New Compound Indexes

**Add to `ensure_indexes.py`:**

```python
INDEXES = {
    "leads": [
        # Existing single-field indexes
        ("stage", 1),
        ("assigned_to", 1),
        ("lead_type", 1),
        ("created_at", -1),
        ("school_id", 1),
        
        # NEW: Compound indexes for filtering
        (("stage", 1), ("created_at", -1)),          # Filter by stage, sorted
        (("assigned_to", 1), ("stage", 1)),          # Owner + stage combo
        (("tag_ids", 1), ("stage", 1)),              # Tag + stage filter
        (("school_id", 1), ("created_at", -1)),      # School's leads
        (("converted_from_contact", 1), ("created_at", -1)),
    ],
    
    "schools": [
        # Existing
        ("school_name", 1),
        ("city", 1),
        ("is_deleted", 1),
        
        # NEW: For tag filtering & ownership
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
        # NEW: For efficient tag lookups
        ("name", 1),
        ("tag_id", 1),
    ],
}
```

**Migration Steps**:
```bash
# 1. Create indexes in background (no downtime)
python backend/ensure_indexes.py --compound

# 2. Monitor index creation
db.leads.find({stage: "qualified"}).explain("executionStats")
# Should show: "stage_1_created_at_-1" in executionStages.stage

# 3. Drop old single-field indexes if duplicated by compound
db.leads.dropIndex("stage_1")  # Only if (stage, created_at) exists
```

---

### 1.2 Query Patterns (Optimized)

**Before (N+1):**
```python
leads = await db.leads.find(query).to_list(10000)
schools = {}
for lead in leads:
    if lead["school_id"] not in schools:
        school = await db.schools.find_one({"school_id": lead["school_id"]})
        schools[lead["school_id"]] = school
    # Now access schools[lead["school_id"]]
```

**After (Batch Query):**
```python
leads = await db.leads.find(query).skip((page-1)*50).limit(50).to_list()

# Single batch query for all schools
school_ids = list(set(l.get("school_id") for l in leads if l.get("school_id")))
schools_cursor = await db.schools.find(
    {"school_id": {"$in": school_ids}},
    {"_id": 0, "school_id": 1, "school_name": 1, "city": 1, "school_type": 1}
)
schools = {s["school_id"]: s async for s in schools_cursor}

# Attach to leads
for lead in leads:
    school = schools.get(lead.get("school_id"), {})
    lead["school_name"] = school.get("school_name", "")
    lead["city"] = school.get("city", "")
```

---

## 2. Caching Layer (Redis)

### 2.1 Cache Architecture

**Redis Installation (Docker):**
```yaml
# docker-compose.yml - add this service
services:
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

volumes:
  redis_data:
```

**Python Redis Client Setup:**
```python
# backend/cache.py (new file)
import redis
import json
import os

redis_client = redis.Redis(
    host=os.environ.get("REDIS_HOST", "localhost"),
    port=int(os.environ.get("REDIS_PORT", 6379)),
    db=0,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_keepalive=True,
)

async def get_cached(key, default=None):
    """Get value from cache, return default if miss"""
    try:
        value = redis_client.get(key)
        return json.loads(value) if value else default
    except Exception:
        return default

async def set_cached(key, value, ttl=600):
    """Set value in cache with TTL (seconds)"""
    try:
        redis_client.setex(key, ttl, json.dumps(value))
    except Exception:
        pass  # Fail silently, don't break API

async def invalidate(pattern):
    """Clear cache entries matching pattern"""
    try:
        keys = redis_client.keys(pattern)
        if keys:
            redis_client.delete(*keys)
    except Exception:
        pass
```

### 2.2 Cache Keys & TTLs

```python
CACHE_SPEC = {
    # School data (10 min - changes infrequently)
    "schools:batch:{hash_of_school_ids}": (schools_list, 600),
    "school:{school_id}": (school_doc, 600),
    
    # Tag metadata (30 min)
    "tags:all": (all_tags_list, 1800),
    "tags:by_id": (tag_id_map, 1800),
    
    # Facet counts (5 min - changes with new leads)
    "facets:leads:{owner}": (facet_counts, 300),
    "facets:leads:all": (global_facets, 300),
    
    # Lead scoring (5 min per lead)
    "lead:{lead_id}:score": (score_dict, 300),
    "lead:{lead_id}:value": (value_dict, 300),
    
    # Import progress (1 hour)
    "import:{import_id}:progress": (progress_dict, 3600),
    "import:{import_id}:result": (result_dict, 3600),
}

# Invalidation patterns
INVALIDATE_ON = {
    "leads.insert": ["facets:leads:*"],
    "leads.update": ["lead:{lead_id}:*", "facets:leads:*"],
    "leads.delete": ["lead:{lead_id}:*", "facets:leads:*"],
    
    "schools.update": ["school:{school_id}", "schools:batch:*"],
    "schools.insert": ["schools:batch:*"],
    
    "tags.insert": ["tags:all", "tags:by_id", "facets:*"],
    "tags.update": ["tags:all", "tags:by_id", "facets:*"],
    "tags.delete": ["tags:all", "tags:by_id", "facets:*"],
}
```

---

## 3. Backend API Redesign

### 3.1 Lead Query Endpoints

**Endpoint 1: List Leads (Paginated)**
```http
GET /leads?page=1&limit=50&stage=negotiation&owner=john@company.com&tag=Care&sort=-created_at&search=acme

Response:
{
  "leads": [
    {
      "lead_id": "lead_123",
      "school_name": "Acme School",
      "city": "NYC",
      "stage": "negotiation",
      "assigned_to": "john@company.com",
      "tags": ["Care", "EU Chandigarh 2026"],
      "created_at": "2026-09-08T12:00:00Z",
      "deal_value": 50000,
      "probability": 65,  # From cache, not calculated here
      "weighted_value": 32500
    },
    ...  # 49 more
  ],
  "total": 5432,           # Total matching records
  "page": 1,               # Current page
  "pages": 109,            # Total pages
  "limit": 50,
  "facets": {
    "stages": {"negotiation": 523, "qualified": 1200, "proposal": 890},
    "tags": {"Care": 3200, "EU Chandigarh 2026": 1500, "GSLC 2026": 800},
    "owners": {"john@company.com": 500, "jane@company.com": 450, ...}
  }
}
```

**Implementation:**
```python
@router.get("/leads")
async def get_leads(
    request: Request,
    page: int = 1,
    limit: int = 50,
    stage: Optional[str] = None,
    owner: Optional[str] = None,
    tag: Optional[str] = None,
    search: Optional[str] = None,
    sort: str = "-created_at"
):
    user = await get_current_user(request)
    
    # Validation
    page = max(1, min(page, 1000))  # 1-1000
    limit = max(1, min(limit, 100)) # 1-100
    
    # Build query filter
    query_filter = {}
    if stage:
        query_filter["stage"] = stage
    if owner:
        query_filter["assigned_to"] = owner
    if tag:
        query_filter["tag_ids"] = tag  # tag_ids is array
    if search:
        query_filter["$or"] = [
            {"school_name": {"$regex": search, "$options": "i"}},
            {"contact_name": {"$regex": search, "$options": "i"}},
            {"company_name": {"$regex": search, "$options": "i"}},
        ]
    
    # Scope check (can user see these leads?)
    if not sees_all(user, "leads"):
        owned = await _owned_school_ids(user["email"])
        query_filter["$or"] = [
            {"assigned_to": user["email"]},
            {"school_id": {"$in": owned}} if owned else {"lead_id": "__none__"}
        ]
    
    # Get total count (for pagination)
    total = await db.leads.count_documents(query_filter)
    
    # Parse sort
    sort_parts = sort.lstrip("-").split(",")
    sort_spec = [
        (part.lstrip("-"), -1 if sort.startswith("-") else 1)
        for part in sort_parts
    ]
    
    # Query leads
    cursor = db.leads.find(
        query_filter,
        {"_id": 0, "lead_id": 1, "school_id": 1, "stage": 1, "assigned_to": 1,
         "tag_ids": 1, "created_at": 1, "deal_value": 1}
    ).sort(sort_spec).skip((page - 1) * limit).limit(limit)
    
    leads = await cursor.to_list()
    
    # Batch-fetch schools from cache or DB
    school_ids = list(set(l.get("school_id") for l in leads if l.get("school_id")))
    cache_key = f"schools:batch:{hash(tuple(sorted(school_ids)))}"
    schools = await get_cached(cache_key)
    
    if not schools:
        school_cursor = db.schools.find(
            {"school_id": {"$in": school_ids}},
            {"_id": 0, "school_id": 1, "school_name": 1, "city": 1, "school_type": 1}
        )
        schools = await school_cursor.to_list()
        await set_cached(cache_key, schools, ttl=600)
    
    school_map = {s["school_id"]: s for s in schools}
    
    # Batch-fetch tag names from cache
    all_tag_ids = list(set(tid for l in leads for tid in (l.get("tag_ids") or [])))
    tag_map = {}
    if all_tag_ids:
        cached_tags = await get_cached("tags:by_id")
        if not cached_tags:
            tag_cursor = db.tags.find(
                {"tag_id": {"$in": all_tag_ids}},
                {"_id": 0, "tag_id": 1, "name": 1}
            )
            cached_tags = {t["tag_id"]: t["name"] async for t in tag_cursor}
            await set_cached("tags:by_id", cached_tags, ttl=1800)
        tag_map = cached_tags
    
    # Enrich leads
    for lead in leads:
        school = school_map.get(lead.get("school_id"), {})
        lead["school_name"] = school.get("school_name", "")
        lead["city"] = school.get("city", "")
        lead["tags"] = [tag_map.get(tid, tid) for tid in (lead.get("tag_ids") or [])]
        # DON'T calculate scoring here - defer to /leads/{id}/details
    
    # Calculate facets from the filtered result (not all leads)
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

**Endpoint 2: Lead Details (With Scoring)**
```http
GET /leads/{lead_id}/details

Response:
{
  "lead_id": "lead_123",
  "school_name": "Acme School",
  "stage": "negotiation",
  "deal_value": 50000,
  "probability": 65,
  "weighted_value": 32500,
  "lead_score": 78,
  "visit_required": true,
  "linked_contact_name": "John Smith",
  ... (full lead object)
}
```

**Implementation:**
```python
@router.get("/leads/{lead_id}/details")
async def get_lead_details(request: Request, lead_id: str):
    user = await get_current_user(request)
    
    # Check cache first
    cached = await get_cached(f"lead:{lead_id}:details")
    if cached:
        return cached
    
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    
    # Verify access
    if not _can_access_lead(user, lead):
        raise HTTPException(403, "Not authorized")
    
    # Fetch school (with cache)
    school = None
    if lead.get("school_id"):
        school = await get_cached(f"school:{lead['school_id']}")
        if not school:
            school = await db.schools.find_one(
                {"school_id": lead["school_id"]}, {"_id": 0}
            )
            if school:
                await set_cached(f"school:{lead['school_id']}", school, ttl=600)
    
    # Calculate expensive scoring (only now)
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

### 3.2 Import/Export Endpoints

**Endpoint: Import with Batch Operations**
```python
@router.post("/import/execute")
async def execute_import(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    rows = body.get("rows", [])
    entity_type = body.get("entity_type", "schools")
    import_id = f"imp_{uuid.uuid4().hex[:8]}"
    
    # Track progress
    progress = {"total": len(rows), "processed": 0, "created": 0, "failed": 0}
    await set_cached(f"import:{import_id}:progress", progress, ttl=3600)
    
    created = 0
    failed = 0
    errors = []
    
    # Batch operations
    schools_to_insert = []
    tags_to_create = []
    tag_links = []
    
    for i, row_data in enumerate(rows):
        if row_data.get("status") != "ok":
            failed += 1
            continue
        
        data = row_data.get("data", {})
        
        try:
            if entity_type == "schools":
                # Prepare school doc
                school_id = f"sch_{uuid.uuid4().hex[:12]}"
                
                # Extract tags FIRST
                tag_ids = []
                tags_str = data.get("tags", "").strip()
                if tags_str:
                    for tag_name in tags_str.split(","):
                        tag_name = tag_name.strip()
                        if tag_name:
                            # Tag creation queued for batch
                            tag_id = f"tag_{uuid.uuid4().hex[:12]}"
                            tags_to_create.append({
                                "tag_id": tag_id,
                                "name": tag_name,
                                "created_by": user["email"],
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            })
                            tag_ids.append(tag_id)
                
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
                    "owner": data.get("owner", "").strip() or user["email"],  # Auto-assign
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
    
    if tags_to_create:
        try:
            await db.tags.insert_many(tags_to_create, ordered=False)
        except Exception:
            pass  # Duplicate tags OK
    
    # Invalidate caches
    await invalidate("facets:*")
    await invalidate("schools:batch:*")
    await invalidate("tags:*")
    
    # Store result
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

**Endpoint: Export Streaming**
```python
@router.get("/export/schools")
async def export_schools(request: Request, format: str = "csv"):
    user = await get_current_user(request)
    
    # Define fields to export
    fields = ["school_id", "school_name", "email", "phone", "city", "state", "owner", "tags"]
    
    async def csv_generator():
        """Stream CSV output without loading all records into memory"""
        # Write header
        yield ",".join(fields) + "\n"
        
        # Stream records in batches
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

---

## 4. Frontend Refactoring

### 4.1 New Hook Architecture

**File: `frontend/src/hooks/useLeadsData.js`**
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
        setLeads(res.leads);
        setTotal(res.total);
        setFacets(res.facets);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchLeads();
  }, [page, limit, JSON.stringify(filters)]);

  return { leads, total, facets, loading, error };
}
```

**File: `frontend/src/hooks/useLeadsFilter.js`**
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
    setFilters({ stage: null, owner: null, tag: null, search: "" });
  }, []);

  return { filters, updateFilter, clearFilters };
}
```

**File: `frontend/src/hooks/useLeadsPagination.js`**
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

### 4.2 Refactored Component

**File: `frontend/src/pages/admin/LeadsCRM.js` (NEW - reduced from 1397 to ~400 lines)**

```javascript
import React, { useState } from 'react';
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

  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-3xl font-bold">Leads</h1>
      
      {/* Filter Bar */}
      <LeadsFilter 
        filters={filters} 
        facets={facets}
        onFilterChange={updateFilter}
        onClear={clearFilters}
      />

      {/* Results */}
      {loading ? (
        <div className="p-4">Loading...</div>
      ) : (
        <>
          <div className="text-sm text-gray-600">
            Showing {((page - 1) * 50) + 1}-{Math.min(page * 50, total)} of {total} leads
          </div>
          
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

---

## 5. Testing Strategy

### 5.1 Performance Tests

```python
# backend/tests/test_crm_performance.py

import pytest
import time
from backend.routes.crm_routes import get_leads

@pytest.mark.asyncio
async def test_lead_list_pagination_under_500ms(db, monkeypatch):
    """GET /leads should return in <500ms with pagination"""
    # Insert 10K test leads
    leads = [
        {
            "lead_id": f"lead_{i}",
            "school_id": f"sch_{i % 100}",
            "stage": "negotiation",
            "created_at": datetime.now(timezone.utc),
        }
        for i in range(10000)
    ]
    await db.leads.insert_many(leads)
    
    # Query first page
    start = time.time()
    result = await get_leads(
        request=MockRequest(),
        page=1,
        limit=50,
        stage="negotiation"
    )
    elapsed = time.time() - start
    
    assert len(result["leads"]) == 50
    assert result["total"] == 10000
    assert elapsed < 0.5, f"Query took {elapsed}s, expected <0.5s"

@pytest.mark.asyncio
async def test_tag_filter_under_200ms(db):
    """Filtering by tag should return in <200ms"""
    # Setup: 1000 leads with tags
    tag_id = "tag_123"
    leads = [
        {
            "lead_id": f"lead_{i}",
            "tag_ids": [tag_id] if i % 10 == 0 else [],
            "stage": "negotiation",
        }
        for i in range(1000)
    ]
    await db.leads.insert_many(leads)
    
    start = time.time()
    result = await get_leads(
        request=MockRequest(),
        page=1,
        limit=50,
        tag=tag_id
    )
    elapsed = time.time() - start
    
    assert elapsed < 0.2, f"Tag filter took {elapsed}s, expected <0.2s"

@pytest.mark.asyncio
async def test_import_500_schools_under_30s():
    """Batch import should process 500 schools in <30s"""
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
    result = await execute_import(
        request=MockRequest(user={"email": "admin@company.com"}),
        body={"rows": rows, "entity_type": "schools"}
    )
    elapsed = time.time() - start
    
    assert result["created"] == 500
    assert elapsed < 30, f"Import took {elapsed}s, expected <30s"
```

### 5.2 Cache Tests

```python
@pytest.mark.asyncio
async def test_cache_invalidation_on_school_update():
    """Cache should be invalidated when school is updated"""
    school_id = "sch_123"
    
    # Load into cache
    await set_cached(f"school:{school_id}", {"name": "Test School"}, ttl=600)
    cached = await get_cached(f"school:{school_id}")
    assert cached is not None
    
    # Update school
    await db.schools.update_one(
        {"school_id": school_id},
        {"$set": {"school_name": "New Name"}}
    )
    
    # Manually trigger invalidation
    await invalidate(f"school:{school_id}")
    
    # Cache should be cleared
    cached = await get_cached(f"school:{school_id}")
    assert cached is None
```

---

## 6. Deployment Checklist

### Phase 1: Infrastructure (Day 1)
- [ ] Deploy Redis service (docker-compose)
- [ ] Add Redis health check to deployment
- [ ] Add Redis monitoring (check connection pools)
- [ ] Test Redis failover (optional but recommended)

### Phase 2: Database (Day 1)
- [ ] Create compound indexes: `ensure_indexes.py --compound`
- [ ] Monitor index creation progress
- [ ] Verify indexes with explain() plans
- [ ] Benchmark queries before/after indexes

### Phase 3: Backend (Day 2)
- [ ] Deploy new endpoints (`/leads` with pagination)
- [ ] Deploy `/leads/{id}/details` endpoint
- [ ] Deploy batch import logic
- [ ] Deploy streaming export
- [ ] Test cache layer (Redis connectivity)
- [ ] Run performance tests (all green)

### Phase 4: Frontend (Day 2-3)
- [ ] Deploy new hooks (useLeadsData, useLeadsFilter, useLeadsPagination)
- [ ] Refactor LeadsCRM component
- [ ] Update LeadsFilter component (for new facets)
- [ ] Update LeadsTable component (if needed)
- [ ] A/B test: 10% traffic → new pagination
- [ ] Gradually roll out: 25% → 50% → 100%

### Phase 5: Cleanup (Day 3)
- [ ] Remove old `/leads` endpoint (after old frontend is gone)
- [ ] Clean up old state management code
- [ ] Monitor error rates and cache hit rates
- [ ] Update documentation

---

## 7. Monitoring & Alerts

**Prometheus Metrics to Add:**

```python
# backend/metrics.py
from prometheus_client import Histogram, Counter, Gauge

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

# Import throughput
import_rows = Counter('import_rows_total', 'Rows imported', ['status'])
import_duration = Histogram('import_duration_seconds', 'Time to import')

# Database
db_operations = Counter('db_operations_total', 'DB operations', ['collection', 'operation'])
db_batch_size = Histogram('db_batch_size', 'Batch operation sizes', ['collection'])
```

**Alert Rules:**

```yaml
# Alert if query takes >1s
- alert: CRMQuerySlow
  expr: histogram_quantile(0.95, crm_query_duration_seconds) > 1
  for: 5m

# Alert if cache hit rate drops below 60%
- alert: CacheLowHitRate
  expr: cache_hit_rate < 0.6
  for: 10m

# Alert if import throughput drops
- alert: ImportSlow
  expr: rate(import_rows_total[5m]) < 10
  for: 5m
```

---

## 8. Rollback Plan

If performance doesn't improve or Redis fails:

1. **Keep old endpoints live** in parallel for 1 week
2. **Gradual rollback**: Redirect 10% → 50% → 100% back to old `/leads` endpoint
3. **Database rollback**: Indexes don't require rollback (read-only)
4. **Cache flush**: `redis-cli FLUSHALL` if cache gets corrupted
5. **Frontend rollback**: Revert to old component (git tag release version)

---

## 9. Success Criteria

| Metric | Before | After | Success |
|--------|--------|-------|---------|
| Lead list response | 10-30s | <500ms | ✓ 60-90x faster |
| Tag filter response | 5-15s | <200ms | ✓ 50-75x faster |
| Import 500 schools | 2-3min | <30s | ✓ 4-6x faster |
| Export 1000 records | 10-20s | <2s | ✓ 5-10x faster |
| Memory usage (leads) | 200MB | 5MB | ✓ 40x less |
| Cache hit rate | 0% | >75% | ✓ Optimal |
| Frontend hang incidents | 5+/day | <1/week | ✓ Eliminated |
| Error rate | <0.5% | <0.1% | ✓ Improved |

---

## 10. Future Enhancements (Post-Launch)

1. **Full-text search** on leads (Elasticsearch integration)
2. **Real-time collaborat** (WebSocket for live filter updates)
3. **AI-powered lead ranking** (ML model for probability)
4. **Custom dashboards** (user-defined facets)
5. **Data warehouse** (Snowflake/BigQuery for analytics)

---

**Document Status: APPROVED FOR IMPLEMENTATION**  
**Author:** Expert Architect  
**Date:** 2026-09-08  
**Revision:** 1.0  
