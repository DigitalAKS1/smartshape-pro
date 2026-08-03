# Multi-Role Users with Per-Module Data Scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one user hold several roles (Sales + Store, Store + Accounts) by turning roles into presets and giving every module grant its own data scope (`own` / `all`).

**Architecture:** `module_permissions` becomes the single source of truth for both capability *and* data visibility. Each grant gains a `scope` field. A new `roles` array on the user records which presets are applied; the existing `role` string is retained as a derived primary so the ~100 legacy `get_team()` call sites keep working untouched. Absent `scope`/`roles` keys fall back to today's role-based rule, so the change is invisible until an admin edits a user.

**Tech Stack:** FastAPI + Motor/MongoDB (backend), React 19 + CRA + Tailwind (frontend), pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-08-03-multi-role-rbac-design.md`

## Global Constraints

- **Branch:** build on `main`, in the worktree `F:/ss-work`. NEVER on `feat/module-rbac` — it is a stale fork that must not be merged.
- **`role` is never removed from a user document.** It is recomputed on save as `"admin"` if `admin` is in `roles`, else `roles[0]`.
- **Scope values are exactly `"own"` and `"all"`.** No `"team"` scope — there is no reporting hierarchy in the system.
- **Additive only:** a user document with no `roles` key and no `scope` keys must resolve to today's behaviour, bit-identically.
- **`MODULE_RBAC_MODE` stays `enforce`.** Do not change the shadow/enforce switch.
- **CRM is gated on the existing `leads` module.** Do not invent a new module name.
- **Python interpreter is `python`** (`python3` is a broken Windows Store stub).
- **`backend/tests/` is gitignored on `main`** — `git add backend/tests/x` silently does nothing. Use `git add -f` for test files.
- **Frontend builds need** `DISABLE_ESLINT_PLUGIN=true`, `NODE_OPTIONS=--max-old-space-size=4096`, and an inline `REACT_APP_BACKEND_URL=https://app.smartshape.in`.

---

### Task 1: `rbac.py` core — roles, teams, scope, preset merge

**Files:**
- Modify: `backend/rbac.py:21-51` (team helpers), `backend/rbac.py:73-129` (module gate + presets)
- Test: `backend/tests/test_rbac_module.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces, all importable from `rbac`:
  - `get_roles(user: dict) -> list[str]`
  - `get_teams(user: dict) -> set[str]`
  - `has_team(user: dict, team: str) -> bool`
  - `get_team(user: dict) -> str` — unchanged signature, now highest-privilege team
  - `module_scope(user: dict, module: str) -> str` — `"own"` or `"all"`
  - `sees_all(user: dict, module: str) -> bool`
  - `has_module(user: dict, module: str, level: str = "read") -> bool`
  - `default_permissions_for_roles(roles: list[str]) -> dict`
  - `default_permissions_for_role(role: str) -> dict` — retained wrapper
  - `PRIMARY_ROLE_ORDER: list[str]`, `VALID_ROLES: tuple[str, ...]`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_rbac_module.py`:

```python
# ---------------- multi-role + per-module scope ----------------

def _muser(roles=None, role=None, perms=None):
    u = {"email": "x@y.com"}
    if role is not None:
        u["role"] = role
    if roles is not None:
        u["roles"] = roles
    if perms is not None:
        u["module_permissions"] = perms
    return u


def test_get_roles_falls_back_to_single_role():
    assert rbac.get_roles(_muser(role="store")) == ["store"]


def test_get_roles_reads_roles_array():
    assert rbac.get_roles(_muser(role="sales_person", roles=["sales_person", "store"])) == [
        "sales_person", "store"
    ]


def test_get_roles_drops_unknown_entries_in_array():
    assert rbac.get_roles(_muser(role="store", roles=["store", "wizard"])) == ["store"]


def test_get_roles_falls_back_when_array_has_nothing_valid():
    assert rbac.get_roles(_muser(role="store", roles=["wizard"])) == ["store"]


def test_get_team_unchanged_for_single_role():
    assert rbac.get_team(_muser(role="admin")) == "admin"
    assert rbac.get_team(_muser(role="accounts")) == "accounts"
    assert rbac.get_team(_muser(role="store")) == "store"
    assert rbac.get_team(_muser(role="sales_person")) == "sales"
    assert rbac.get_team(_muser(role="wizard")) == "sales"
    assert rbac.get_team({"email": "x@y.com"}) == "sales"


def test_get_team_returns_highest_privilege_of_the_set():
    assert rbac.get_team(_muser(role="sales_person", roles=["sales_person", "store"])) == "store"
    assert rbac.get_team(_muser(role="store", roles=["store", "accounts"])) == "accounts"
    assert rbac.get_team(_muser(role="admin", roles=["admin", "sales_person"])) == "admin"


def test_get_teams_and_has_team():
    u = _muser(role="sales_person", roles=["sales_person", "store"])
    assert rbac.get_teams(u) == {"sales", "store"}
    assert rbac.has_team(u, "sales") is True
    assert rbac.has_team(u, "accounts") is False


def test_require_teams_passes_on_any_overlap():
    u = _muser(role="store", roles=["store", "sales_person"])
    rbac.require_teams(u, "sales")            # no raise — holds sales
    rbac.require_teams(u, "accounts", "store")  # no raise — holds store
    with pytest.raises(HTTPException) as e:
        rbac.require_teams(u, "accounts")
    assert e.value.status_code == 403


def test_require_admin_unchanged():
    rbac.require_admin(_muser(role="admin"))
    with pytest.raises(HTTPException):
        rbac.require_admin(_muser(role="store"))


def test_module_scope_uses_explicit_grant():
    u = _muser(role="store", perms={"leads": {"level": "read_write", "scope": "own"}})
    assert rbac.module_scope(u, "leads") == "own"
    assert rbac.sees_all(u, "leads") is False


def test_module_scope_admin_is_always_all():
    assert rbac.module_scope(_muser(role="admin"), "leads") == "all"


def test_module_scope_legacy_fallback_matches_today():
    # No scope key anywhere — must reproduce the old role-based rule exactly.
    sales = _muser(role="sales_person", perms={"quotations": {"level": "read_write"}})
    store = _muser(role="store", perms={"orders": {"level": "read_write"}})
    accounts = _muser(role="accounts", perms={"orders": {"level": "read_write"}})
    assert rbac.module_scope(sales, "quotations") == "own"
    assert rbac.module_scope(store, "orders") == "all"
    assert rbac.module_scope(accounts, "orders") == "all"


def test_module_scope_fallback_for_ungranted_module():
    assert rbac.module_scope(_muser(role="sales_person", perms={}), "orders") == "own"
    assert rbac.module_scope(_muser(role="store", perms={}), "orders") == "all"


def test_bad_scope_value_falls_back():
    u = _muser(role="sales_person", perms={"leads": {"level": "read", "scope": "galaxy"}})
    assert rbac.module_scope(u, "leads") == "own"


def test_has_module_is_non_raising():
    u = _muser(role="store", perms={"leads": {"level": "read"}})
    assert rbac.has_module(u, "leads") is True
    assert rbac.has_module(u, "leads", "read_write") is False
    assert rbac.has_module(u, "payroll") is False
    assert rbac.has_module(_muser(role="admin"), "payroll", "read_write_delete") is True


def test_merged_presets_take_max_level_and_widest_scope():
    merged = rbac.default_permissions_for_roles(["sales_person", "store"])
    # store contributes org-wide orders at read_write
    assert merged["orders"]["level"] == "read_write"
    assert merged["orders"]["scope"] == "all"
    # sales contributes own-scoped leads
    assert merged["leads"]["scope"] == "own"
    # quotations exist in both: sales read_write/own vs store read/all -> max level, widest scope
    assert merged["quotations"]["level"] == "read_write"
    assert merged["quotations"]["scope"] == "all"


def test_merged_presets_with_admin_is_empty():
    assert rbac.default_permissions_for_roles(["admin", "store"]) == {}


def test_default_permissions_for_role_wrapper_still_works():
    assert rbac.default_permissions_for_role("store") == rbac.default_permissions_for_roles(["store"])


def test_preset_merge_does_not_mutate_the_template():
    before = rbac.ROLE_DEFAULT_PERMISSIONS["store"]["orders"]["level"]
    rbac.default_permissions_for_roles(["sales_person", "store"])
    assert rbac.ROLE_DEFAULT_PERMISSIONS["store"]["orders"]["level"] == before


def test_sales_person_presets_are_own_scoped():
    perms = rbac.default_permissions_for_roles(["sales_person"])
    assert all(g["scope"] == "own" for g in perms.values())


def test_store_presets_are_all_scoped():
    perms = rbac.default_permissions_for_roles(["store"])
    assert all(g["scope"] == "all" for g in perms.values())
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_rbac_module.py -v
```

Expected: FAIL — `AttributeError: module 'rbac' has no attribute 'get_roles'`.

- [ ] **Step 3: Replace the team helpers in `backend/rbac.py`**

Replace lines 21-41 (`get_team` through `require_teams`) with:

```python
VALID_ROLES = ("admin", "accounts", "store", "sales_person")

# role -> logical team
_ROLE_TEAM = {
    "admin": "admin",
    "accounts": "accounts",
    "store": "store",
    "sales_person": "sales",
}

# Highest privilege last. get_team() returns the highest team a user holds so the
# ~100 legacy call sites behave as "widest role wins" without being edited.
_TEAM_RANK = {"sales": 0, "store": 1, "accounts": 2, "admin": 3}

# Order used to pick the derived primary `role` when several are held.
PRIMARY_ROLE_ORDER = ["admin", "accounts", "store", "sales_person"]


def get_roles(user: dict) -> list[str]:
    """Every role the user holds. Falls back to the legacy single `role` string."""
    roles = user.get("roles")
    if isinstance(roles, list):
        valid = [r for r in roles if r in _ROLE_TEAM]
        if valid:
            return valid
    return [user.get("role") or "sales_person"]


def get_teams(user: dict) -> set:
    """All logical teams the user belongs to."""
    return {_ROLE_TEAM.get(r, "sales") for r in get_roles(user)}


def has_team(user: dict, team: str) -> bool:
    return team in get_teams(user)


def get_team(user: dict) -> str:
    """The user's highest-privilege team: 'admin' | 'accounts' | 'store' | 'sales'.

    Signature unchanged. For a single-role user this returns exactly what it always
    did; for a multi-role user it returns the widest, which is what the legacy
    call sites want.
    """
    return max(get_teams(user), key=lambda t: _TEAM_RANK[t])


def require_admin(user: dict):
    if not has_team(user, "admin"):
        raise HTTPException(status_code=403, detail="Admin access required")


def require_teams(user: dict, *teams: str):
    """Raise 403 unless the user holds at least one of the allowed teams."""
    if not (get_teams(user) & set(teams)):
        raise HTTPException(status_code=403, detail="Access denied for your role")
```

- [ ] **Step 4: Add the scope + capability helpers**

In `backend/rbac.py`, immediately after the `require_module` function (currently ending at line 95), add:

```python
def has_module(user: dict, module: str, level: str = "read") -> bool:
    """Non-raising sibling of require_module. Admin always True."""
    if has_team(user, "admin"):
        return True
    perms = (user.get("module_permissions") or {}).get(module) or {}
    return LEVELS.get(perms.get("level", "none"), 0) >= LEVELS.get(level, 99)


def module_scope(user: dict, module: str) -> str:
    """'own' (only records the user owns) or 'all' (org-wide) for this module.

    Reads the grant's explicit `scope`. When absent — every pre-existing user —
    it falls back to the legacy role rule: a sales-only user sees own records,
    everyone else sees all. That keeps untouched users behaving identically.
    """
    if has_team(user, "admin"):
        return "all"
    grant = (user.get("module_permissions") or {}).get(module) or {}
    scope = grant.get("scope")
    if scope in ("own", "all"):
        return scope
    return "own" if get_teams(user) == {"sales"} else "all"


def sees_all(user: dict, module: str) -> bool:
    """True when the user may see every record in this module, not just their own."""
    return module_scope(user, module) == "all"
```

- [ ] **Step 5: Add explicit scope to the presets and add the merge function**

Replace lines 101-129 of `backend/rbac.py` (the `_RW`/`_RWD`/`_R` constants through `default_permissions_for_role`) with:

```python
_RW = {"level": "read_write", "can_download": True, "scope": "all"}
_RWD = {"level": "read_write_delete", "can_download": True, "scope": "all"}
_R = {"level": "read", "can_download": True, "scope": "all"}
_RW_OWN = {"level": "read_write", "can_download": True, "scope": "own"}
_R_OWN = {"level": "read", "can_download": True, "scope": "own"}

ROLE_DEFAULT_PERMISSIONS = {
    "accounts": {
        "dashboard": _R, "quotations": _RWD, "orders": _RW, "procurement": _RW,
        "invoices": _RWD, "accounts": _RW, "payroll": _RW, "analytics": _R,
        "field_sales": _R, "hr": _R, "leave_management": _RW, "settings": _R,
    },
    "store": {
        "dashboard": _R, "quotations": _R, "orders": _RW, "procurement": _RW,
        "inventory": _RWD, "stock_management": _RW, "purchase_alerts": _RW,
        "package_master": _RW, "physical_count": _RW, "store": _RW,
        "leave_management": _RW, "analytics": _R,
    },
    "sales_person": {
        "dashboard": _R_OWN, "quotations": _RW_OWN, "leads": _RW_OWN,
        "field_sales": _RW_OWN, "sales_portal": _RW_OWN,
        "leave_management": _RW_OWN, "analytics": _R_OWN,
    },
}


def default_permissions_for_roles(roles: list) -> dict:
    """Merge the presets of every role held: max level, widest scope, OR'd download.

    Admin returns {} — it bypasses all module checks.
    """
    if "admin" in roles:
        return {}
    merged: dict = {}
    for role in roles:
        for mod, grant in ROLE_DEFAULT_PERMISSIONS.get(role, {}).items():
            cur = merged.get(mod)
            if cur is None:
                merged[mod] = dict(grant)  # copy so the template is never mutated
                continue
            if LEVELS[grant["level"]] > LEVELS[cur["level"]]:
                cur["level"] = grant["level"]
            if grant.get("scope") == "all":
                cur["scope"] = "all"
            cur["can_download"] = bool(cur.get("can_download")) or bool(grant.get("can_download"))
    return merged


def default_permissions_for_role(role: str) -> dict:
    """Complete module_permissions for a single role. Admin returns {}."""
    return default_permissions_for_roles([role])
```

- [ ] **Step 6: Run the full rbac test file**

```bash
cd backend && python -m pytest tests/test_rbac_module.py -v
```

Expected: PASS, including the six pre-existing tests (`test_admin_bypasses_every_module` … `test_admin_default_is_empty`) which must not regress.

- [ ] **Step 7: Commit**

```bash
git add backend/rbac.py
git add -f backend/tests/test_rbac_module.py
git commit -m "feat(rbac): multi-role users and per-module data scope helpers"
```

---

### Task 2: Own-record filters in quotations, orders and the customer portal

**Files:**
- Modify: `backend/routes/quotation_routes.py:370,579,656,682`
- Modify: `backend/routes/order_routes.py:109,948,1112`
- Modify: `backend/routes/customer_routes.py:252`

**Interfaces:**
- Consumes: `rbac.sees_all(user, module)` from Task 1.
- Produces: nothing new — behaviour change only.

- [ ] **Step 1: Update the quotation imports**

`backend/routes/quotation_routes.py:13` currently reads:

```python
from rbac import get_team, require_teams, require_module
```

Change it to:

```python
from rbac import get_team, require_teams, require_module, sees_all
```

- [ ] **Step 2: Replace the four quotation scope checks**

At `quotation_routes.py:370`, inside `get_quotations`:

```python
    elif not sees_all(user, "quotations"):
        # Users whose quotations grant is own-scoped see only their own
        query["sales_person_email"] = user["email"]
```

At `quotation_routes.py:577-580`:

```python
    require_module(user, "quotations", "read_write")
    if not sees_all(user, "quotations") and existing.get("sales_person_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="You can only edit your own quotations")
```

Delete the now-unused `_team = get_team(user)` line directly above it.

At `quotation_routes.py:654-657`:

```python
    require_module(user, "quotations", "read_write")
    if not sees_all(user, "quotations") and quot.get("sales_person_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="You can only edit your own quotations")
```

Delete the now-unused `_team = get_team(user)` line directly above it.

At `quotation_routes.py:677-682`, inside `_get_quotation_for_po`:

```python
async def _get_quotation_for_po(quotation_id: str, user: dict):
    """Fetch the quotation and enforce write access via the quotations grant."""
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    require_module(user, "quotations", "read_write")
    if not sees_all(user, "quotations") and quot.get("sales_person_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="You can only manage PO for your own quotations")
    return quot
```

Note the `team = get_team(user)` line is removed from this function.

- [ ] **Step 3: Update the order imports and the three order scope checks**

`backend/routes/order_routes.py:12` becomes:

```python
from rbac import get_team, require_teams, require_superadmin, require_module, sees_all
```

At `order_routes.py:108-114` in `get_orders`:

```python
    if not sees_all(user, "orders"):
        # Own-scoped users see only orders they created (from their quotations)
        query = {"created_by": user["email"]}
    else:
        query = {}
```

At `order_routes.py:947-952` in `get_dispatches`:

```python
    if not sees_all(user, "orders"):
        own_orders = await db.orders.find({"created_by": user["email"]}, {"_id": 0, "order_id": 1}).to_list(10000)
        order_ids = [o["order_id"] for o in own_orders]
        query = {"order_id": {"$in": order_ids}} if order_ids else {"order_id": "__none__"}
    else:
```

At `order_routes.py:1111-1116` in `get_holds`:

```python
    if not sees_all(user, "orders"):
        own_orders = await db.orders.find({"created_by": user["email"]}, {"_id": 0, "order_id": 1}).to_list(10000)
        order_ids = [o["order_id"] for o in own_orders]
        item_query = {"status": "on_hold", "order_id": {"$in": order_ids}} if order_ids else {"status": "on_hold", "order_id": "__none__"}
    else:
        item_query = {"status": "on_hold"}
```

In all three, leave the `team = get_team(user)` line in place only if `team` is still referenced further down the same function; otherwise delete it. Check each function body before deleting.

- [ ] **Step 4: Simplify the customer-portal owner bypass**

`backend/routes/customer_routes.py:9` needs no change — this step removes the only `get_team` use in the function but the import stays for other call sites. Verify with pyflakes in Step 6.

At `customer_routes.py:249-253`, the `team == "sales"` half of the condition is redundant once scope is per-module. Replace with:

```python
    # The owning sales person may always edit; everyone else needs module access.
    owns = (quot.get("sales_person_email", "").lower() == user.get("email", "").lower())
    if not owns:
        require_module(user, "quotations", "read_write")
```

Delete the `team = get_team(user)` line above it if `team` is unused in the rest of the function.

- [ ] **Step 5: Verify the modules import cleanly**

```bash
cd backend && python -c "import routes.quotation_routes, routes.order_routes, routes.customer_routes; print('imports OK')"
```

Expected: `imports OK`. A `NameError` for `team` or `sees_all` here means a leftover reference — fix it before committing.

- [ ] **Step 6: Check for orphaned `team` references**

```bash
cd backend && python -m pyflakes routes/quotation_routes.py routes/order_routes.py routes/customer_routes.py
```

Expected: no `undefined name` or `local variable 'team' ... assigned but never used` lines for the functions you touched. If `pyflakes` is not installed, run `python -m pip install pyflakes` first.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/quotation_routes.py backend/routes/order_routes.py backend/routes/customer_routes.py
git commit -m "feat(rbac): scope quotations/orders visibility by module grant, not role"
```

---

### Task 3: CRM access gated on the `leads` module

**Files:**
- Modify: `backend/routes/crm_routes.py:787,809,827,940,1055,1686,2322,2376,2608,2650,2704`

**Interfaces:**
- Consumes: `rbac.has_module(user, module, level)` and `rbac.sees_all(user, module)` from Task 1.
- Produces: nothing new — behaviour change only.

Existing helpers in this file that the replacements reuse: `_owned_school_ids(email)` and `_sales_lead_scope(email)`.

- [ ] **Step 1: Update the import**

`backend/routes/crm_routes.py:18` becomes:

```python
from rbac import get_team, require_superadmin, require_module, has_module, has_team, sees_all
```

- [ ] **Step 2: Rewrite the three mutation guards (lines 782-840)**

`_user_can_view_school`:

```python
    if not school:
        return False
    if has_team(user, "admin"):
        return True
    if not has_module(user, "leads"):
        return False
    if sees_all(user, "leads"):
        return True
    email = user["email"]
    if school.get("assigned_to") == email or school.get("created_by") == email:
        return True
    sid = school.get("school_id")
    if sid:
        lead = await db.leads.find_one(
            {"school_id": sid, "assigned_to": email}, {"_id": 0, "lead_id": 1}
        )
        if lead:
            return True
    return False
```

`_user_can_mutate_lead`:

```python
    if not lead:
        return False
    if has_team(user, "admin"):
        return True
    if not has_module(user, "leads", "read_write"):
        return False
    if sees_all(user, "leads"):
        return True
    email = user["email"]
    if lead.get("assigned_to") == email:
        return True
    sid = lead.get("school_id")
    if sid and sid in (await _owned_school_ids(email)):
        return True
    return False
```

`_user_can_mutate_contact`:

```python
    if not contact:
        return False
    if has_team(user, "admin"):
        return True
    if not has_module(user, "leads", "read_write"):
        return False
    if sees_all(user, "leads"):
        return True
    email = user["email"]
    if contact.get("created_by") == email or contact.get("assigned_to") == email:
        return True
    sid = contact.get("school_id")
    if sid and sid in (await _owned_school_ids(email)):
        return True
```

Leave the remainder of `_user_can_mutate_contact` (below line 834) untouched. Delete each now-unused `team = get_team(user)` line in these three helpers.

- [ ] **Step 3: Rewrite `directory_claim` (line 938-941)**

```python
    if not has_module(user, "leads", "read_write"):
        raise HTTPException(status_code=403, detail="No CRM access")
```

Delete the `team = get_team(user)` line above it if `team` is unused further down the function.

- [ ] **Step 4: Rewrite the four list endpoints**

`get_schools` at line 1052-1057:

```python
    if not has_module(user, "leads"):
        # No CRM grant — nothing to show
        return []
    if sees_all(user, "leads"):
        query = {}
    else:  # own-scoped — owned schools + created + schools holding their leads
```

Keep the existing `else:` body (the `own_leads` lookup and `$or` query) exactly as it is; only the branch conditions above it change.

`get_contacts` at line 1683-1688:

```python
    if not has_module(user, "leads"):
        return []
    if sees_all(user, "leads"):
        query = {}
    else:  # own-scoped — own + assigned + everything under owned schools
```

Keep the existing `else:` body unchanged.

`get_leads` at line 2319-2324:

```python
    if not has_module(user, "leads"):
        return []
    if sees_all(user, "leads"):
        query = {}
    else:  # own-scoped — assigned + everything under owned schools
```

Keep the existing `else:` body unchanged.

The lead-search endpoint at line 2374-2377:

```python
    if not has_module(user, "leads"):
        return {"leads": []}
    if sees_all(user, "leads"):
        scope = {}
    else:  # own-scoped — assigned + everything under owned schools
```

Keep the existing `else:` body unchanged.

In each of the four, delete the `team = get_team(user)` line if `team` is not referenced elsewhere in the same function.

- [ ] **Step 5: Rewrite the three analytics endpoints**

`leads_forecast` at line 2607-2610:

```python
    if not has_module(user, "leads"):
        return {"total_value": 0, "total_weighted": 0, "by_stage": {}, "by_rep": {}}
    query = {} if sees_all(user, "leads") else {"$or": await _sales_lead_scope(user["email"])}
```

`leads_funnel` at line 2649-2653:

```python
    if not has_module(user, "leads"):
        return {"stages": [], "won": {"count": 0, "value": 0}, "lost": {"count": 0}, "lost_reasons": {}}
    query = {} if sees_all(user, "leads") else {"$or": await _sales_lead_scope(user["email"])}
    if rep and sees_all(user, "leads"):
        query["assigned_to"] = rep
```

`leads_needs_attention` at line 2703-2708:

```python
    if not has_module(user, "leads"):
        return []
    query = {"stage": {"$in": OPEN_STAGES}}
    if not sees_all(user, "leads"):
        query["$or"] = await _sales_lead_scope(user["email"])
```

Delete each now-unused `team = get_team(user)` line.

- [ ] **Step 6: Verify the module imports and has no orphaned names**

```bash
cd backend && python -c "import routes.crm_routes; print('imports OK')" && python -m pyflakes routes/crm_routes.py
```

Expected: `imports OK`, and no `undefined name 'team'` from pyflakes.

- [ ] **Step 7: Confirm no `team in ("accounts", "store")` blocks remain**

```bash
cd backend && grep -rn 'team in ("accounts", "store")' routes/
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/crm_routes.py
git commit -m "feat(rbac): gate CRM on the leads module grant instead of the role string"
```

---

### Task 4: Admin API accepts a `roles` array

**Files:**
- Modify: `backend/routes/admin_routes.py:137-172` (create), `backend/routes/admin_routes.py:201-210` (update)
- Test: `backend/tests/test_admin_roles.py` (create)

**Interfaces:**
- Consumes: `rbac.VALID_ROLES`, `rbac.PRIMARY_ROLE_ORDER`, `rbac.default_permissions_for_roles` from Task 1.
- Produces: `normalize_roles(body: dict) -> tuple[list[str], str]` in `backend/routes/admin_routes.py`, returning `(roles, primary_role)`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_admin_roles.py`:

```python
"""Pure-Python tests for role-array normalisation on the admin user API."""
from routes.admin_routes import normalize_roles


def test_single_role_string_still_works():
    assert normalize_roles({"role": "store"}) == (["store"], "store")


def test_roles_array_wins_over_role_string():
    assert normalize_roles({"role": "sales_person", "roles": ["store", "accounts"]}) == (
        ["store", "accounts"], "accounts"
    )


def test_admin_is_exclusive():
    assert normalize_roles({"roles": ["admin", "store"]}) == (["admin"], "admin")


def test_unknown_roles_are_dropped():
    assert normalize_roles({"roles": ["store", "wizard"]}) == (["store"], "store")


def test_empty_after_validation_defaults_to_sales():
    assert normalize_roles({"roles": ["wizard"]}) == (["sales_person"], "sales_person")
    assert normalize_roles({}) == (["sales_person"], "sales_person")


def test_duplicates_are_collapsed_preserving_order():
    assert normalize_roles({"roles": ["store", "store", "sales_person"]}) == (
        ["store", "sales_person"], "store"
    )


def test_primary_is_the_highest_privilege_held():
    assert normalize_roles({"roles": ["sales_person", "store"]})[1] == "store"
    assert normalize_roles({"roles": ["sales_person", "accounts"]})[1] == "accounts"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && python -m pytest tests/test_admin_roles.py -v
```

Expected: FAIL with `ImportError: cannot import name 'normalize_roles'`.

- [ ] **Step 3: Add `normalize_roles` to `admin_routes.py`**

Extend the existing import at `backend/routes/admin_routes.py:12`:

```python
from rbac import (get_team, require_admin, require_teams, require_superadmin, require_module,
                  VALID_ROLES, PRIMARY_ROLE_ORDER, default_permissions_for_roles)
```

Then add this function near the top of the file, after the imports:

```python
def normalize_roles(body: dict) -> tuple:
    """Validate the roles a client sent and derive the primary `role` string.

    Accepts either the new `roles` array or the legacy `role` string. Admin is
    exclusive — it collapses to ["admin"]. Returns (roles, primary_role).
    """
    raw = body.get("roles")
    if not isinstance(raw, list) or not raw:
        raw = [body.get("role") or "sales_person"]
    seen, roles = set(), []
    for r in raw:
        if r in VALID_ROLES and r not in seen:
            seen.add(r)
            roles.append(r)
    if not roles:
        roles = ["sales_person"]
    if "admin" in roles:
        roles = ["admin"]
    primary = next(r for r in PRIMARY_ROLE_ORDER if r in roles)
    return roles, primary
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && python -m pytest tests/test_admin_roles.py -v
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Wire `normalize_roles` into user creation**

In `admin_create_user`, replace lines 137-139:

```python
    roles, role = normalize_roles(body)
```

Replace line 166 (`"sales_role": sales_role if role == "sales_person" else None,`) with:

```python
        "sales_role": sales_role if "sales_person" in roles else None,
```

Add `"roles": roles,` to `user_doc` immediately after the `"role": role,` line (line 163).

Replace lines 171-172 so a user created without an explicit matrix gets the merged presets:

```python
    if isinstance(module_permissions, dict):
        user_doc["module_permissions"] = module_permissions
    else:
        user_doc["module_permissions"] = default_permissions_for_roles(roles)
        if not assigned_modules:
            assigned_modules = [
                m for m, p in user_doc["module_permissions"].items()
                if p.get("level", "none") != "none"
            ]
            user_doc["assigned_modules"] = assigned_modules
```

- [ ] **Step 6: Wire `normalize_roles` into user update**

In `admin_update_user`, add `"roles"` to the allowed-fields tuple at line 203:

```python
    for key in ("name", "role", "roles", "phone", "calling_number", "designation", "sales_role", "assigned_modules", "is_active", "module_permissions"):
```

Then immediately after that loop, before the `assigned_modules` sync block at line 207, add:

```python
    # Keep `role` and `roles` consistent whenever either one is being changed.
    if "roles" in allowed_fields or "role" in allowed_fields:
        roles, primary = normalize_roles(allowed_fields)
        allowed_fields["roles"] = roles
        allowed_fields["role"] = primary
        if "sales_person" not in roles:
            allowed_fields["sales_role"] = None
```

- [ ] **Step 7: Verify the module still imports and all backend tests pass**

```bash
cd backend && python -c "import routes.admin_routes; print('imports OK')" && python -m pytest tests/test_rbac_module.py tests/test_admin_roles.py -v
```

Expected: `imports OK` and all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/admin_routes.py
git add -f backend/tests/test_admin_roles.py
git commit -m "feat(rbac): admin user API accepts a roles array and derives the primary role"
```

---

### Task 5: Idempotent backfill script

**Files:**
- Create: `backend/migrations/backfill_user_roles_scope.py`

**Interfaces:**
- Consumes: `rbac.get_teams`, `rbac.VALID_ROLES` from Task 1.
- Produces: a standalone script; nothing imports it.

Model it on the existing `backend/migrations/backfill_module_permissions.py` — read that file first and copy its DB-connection and `__main__` idiom exactly rather than inventing a new one.

- [ ] **Step 1: Write the script**

Create `backend/migrations/backfill_user_roles_scope.py`:

```python
"""Backfill `roles` and per-grant `scope` so the users collection is self-describing.

Idempotent and non-destructive: it writes only the values that rbac.py would have
inferred anyway, so running it changes no one's effective access. Safe to re-run.

Usage:  cd backend && python migrations/backfill_user_roles_scope.py [--apply]
Without --apply it is a dry run and prints what it would change.
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import db  # noqa: E402
from rbac import VALID_ROLES  # noqa: E402


def _scope_for(role: str) -> str:
    """The scope rbac.module_scope() would infer for a single-role user."""
    return "own" if role == "sales_person" else "all"


async def main(apply: bool):
    users = await db.users.find({}, {"_id": 0, "user_id": 1, "email": 1, "role": 1,
                                     "roles": 1, "module_permissions": 1}).to_list(10000)
    changed = 0
    for u in users:
        role = u.get("role") or "sales_person"
        if role not in VALID_ROLES:
            role = "sales_person"
        update = {}

        if not isinstance(u.get("roles"), list) or not u.get("roles"):
            update["roles"] = [role]

        perms = u.get("module_permissions") or {}
        if perms:
            new_perms = {}
            touched = False
            for mod, grant in perms.items():
                g = dict(grant or {})
                if g.get("scope") not in ("own", "all"):
                    g["scope"] = "all" if role == "admin" else _scope_for(role)
                    touched = True
                new_perms[mod] = g
            if touched:
                update["module_permissions"] = new_perms

        if not update:
            continue
        changed += 1
        print(f"{'APPLY ' if apply else 'DRY   '} {u.get('email')}: {sorted(update.keys())}")
        if apply:
            await db.users.update_one({"user_id": u["user_id"]}, {"$set": update})

    print(f"\n{changed} of {len(users)} users {'updated' if apply else 'would be updated'}.")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
```

- [ ] **Step 2: Run the dry run**

```bash
cd backend && python migrations/backfill_user_roles_scope.py
```

Expected: a `DRY` line per user needing a backfill, then a summary count. **This connects to the production database** — confirm the dry-run output looks right before applying anything.

- [ ] **Step 3: Verify re-running the dry run after an apply would be a no-op**

Do not run `--apply` yet — that happens at deploy time in Task 9. For now just confirm the script reports a count without erroring.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/backfill_user_roles_scope.py
git commit -m "chore(rbac): idempotent backfill for user roles and grant scope"
```

---

### Task 6: Frontend permission hooks

**Files:**
- Modify: `frontend/src/hooks/usePermission.js:24-90`

**Interfaces:**
- Consumes: `user.roles`, `user.role`, `user.module_permissions[module].scope` from the `/me` payload.
- Produces:
  - `useRoles(): string[]`
  - `useTeams(): string[]`
  - `useTeam(): string` — unchanged signature, now highest-privilege
  - `usePermission(module): { canView, canWrite, canDelete, canDownload, scope, seesAll }`

- [ ] **Step 1: Replace `useTeam` with the multi-role trio**

In `frontend/src/hooks/usePermission.js`, replace the `useTeam` function (lines 17-32) with:

```javascript
const ROLE_TEAM = {
  admin: 'admin',
  accounts: 'accounts',
  store: 'store',
  sales_person: 'sales',
};
const TEAM_RANK = { sales: 0, store: 1, accounts: 2, admin: 3 };

function rolesOf(user) {
  const list = Array.isArray(user?.roles) ? user.roles.filter(r => ROLE_TEAM[r]) : [];
  if (list.length) return list;
  return [user?.role || 'sales_person'];
}

/** Every role the current user holds. */
export function useRoles() {
  const { user } = useAuth();
  return user ? rolesOf(user) : [];
}

/** Every logical team the current user belongs to. */
export function useTeams() {
  const { user } = useAuth();
  if (!user) return ['guest'];
  return [...new Set(rolesOf(user).map(r => ROLE_TEAM[r] || 'sales'))];
}

/**
 * The current user's highest-privilege team. Mirrors the backend get_team().
 *   'admin' > 'accounts' > 'store' > 'sales'
 */
export function useTeam() {
  const { user } = useAuth();
  if (!user) return 'guest';
  return rolesOf(user)
    .map(r => ROLE_TEAM[r] || 'sales')
    .reduce((best, t) => (TEAM_RANK[t] > TEAM_RANK[best] ? t : best), 'sales');
}
```

- [ ] **Step 2: Make `usePermission` union role defaults and expose scope**

Replace the body of `usePermission` (lines 48-90) with:

```javascript
export function usePermission(module) {
  const { user } = useAuth();
  const teams = useTeams();

  if (!user) return { ...NONE, scope: 'own', seesAll: false };
  if (teams.includes('admin'))
    return { canView: true, canWrite: true, canDelete: true, canDownload: true, scope: 'all', seesAll: true };

  // 1) Explicit module grant (works for every non-admin team)
  const modulePerms = user.module_permissions?.[module];
  const isAssigned  = (user.assigned_modules || []).includes(module);
  const level = modulePerms?.level || (isAssigned ? 'read_write' : 'none');
  const grant = {
    canView:     level !== 'none',
    canWrite:    level === 'read_write' || level === 'read_write_delete',
    canDelete:   level === 'read_write_delete',
    canDownload: modulePerms?.can_download === true,
  };

  // 2) Legacy role defaults, unioned across every role held (additive — never removes access)
  const ACCOUNTS_WRITE = ['quotations', 'accounts', 'payroll'];
  const ACCOUNTS_READ  = ['dashboard', 'analytics', 'leave_management'];
  const STORE_WRITE    = ['inventory', 'stock_management', 'purchase_alerts', 'physical_count', 'store', 'package_master'];
  const STORE_READ     = ['quotations', 'dashboard', 'leave_management'];

  let roleDefault = { ...NONE };
  teams.forEach(team => {
    let d = NONE;
    if (team === 'accounts') {
      if (ACCOUNTS_WRITE.includes(module)) d = { canView: true, canWrite: true, canDelete: false, canDownload: true };
      else if (ACCOUNTS_READ.includes(module)) d = { canView: true, canWrite: false, canDelete: false, canDownload: false };
    } else if (team === 'store') {
      if (STORE_WRITE.includes(module)) d = { canView: true, canWrite: true, canDelete: false, canDownload: true };
      else if (STORE_READ.includes(module)) d = { canView: true, canWrite: false, canDelete: false, canDownload: false };
    }
    roleDefault = {
      canView:     roleDefault.canView     || d.canView,
      canWrite:    roleDefault.canWrite    || d.canWrite,
      canDelete:   roleDefault.canDelete   || d.canDelete,
      canDownload: roleDefault.canDownload || d.canDownload,
    };
  });

  // 3) Data scope — explicit grant scope, else the legacy role rule
  let scope = modulePerms?.scope;
  if (scope !== 'own' && scope !== 'all') {
    scope = (teams.length === 1 && teams[0] === 'sales') ? 'own' : 'all';
  }

  return {
    canView:     grant.canView     || roleDefault.canView,
    canWrite:    grant.canWrite    || roleDefault.canWrite,
    canDelete:   grant.canDelete   || roleDefault.canDelete,
    canDownload: grant.canDownload || roleDefault.canDownload,
    scope,
    seesAll: scope === 'all',
  };
}
```

- [ ] **Step 3: Verify the app still compiles**

```bash
cd frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```

Expected: `Compiled successfully` (warnings are acceptable). This is slow — several minutes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/usePermission.js
git commit -m "feat(rbac): frontend hooks for multiple roles and per-module scope"
```

---

### Task 7: User form — role checkboxes, scope column, preset button

**Files:**
- Modify: `frontend/src/components/admin/UserFormDialog.js` (whole file)

**Interfaces:**
- Consumes: `form.roles` (array) and `form.module_permissions[mod].scope` from Task 8's form state; `handlePermissionsChange`, `handleRolesChange`, `applyRolePresets` props from Task 8.
- Produces: the edited dialog. Task 8 supplies the new props.

**Note:** Task 8 adds `handleRolesChange` and `applyRolePresets` to the hook. Implement this task and Task 8 together, or expect a runtime error on the missing props until Task 8 lands.

- [ ] **Step 1: Add the scope constant and role list at the top of the file**

After the `LEVELS` constant (line 17), add:

```javascript
const SCOPES = [
  { value: 'own', label: 'Own records' },
  { value: 'all', label: 'All records' },
];

const ROLE_OPTIONS = [
  { value: 'admin',        label: 'Admin',    hint: 'Full access to everything' },
  { value: 'accounts',     label: 'Accounts', hint: 'All quotations & financials' },
  { value: 'store',        label: 'Store',    hint: 'All orders & inventory' },
  { value: 'sales_person', label: 'Sales',    hint: 'Leads, CRM & own quotations' },
];
```

- [ ] **Step 2: Add a scope setter and a Scope column to `PermMatrix`**

Add this setter alongside `setLevel` and `toggleDownload` (after line 32):

```javascript
  const setScope = (modName, scope) => {
    const cur = permissions[modName] || { level: 'read', can_download: false };
    onChange({ ...permissions, [modName]: { ...cur, scope } });
  };
```

In `setLevel`, default the scope when a module is first granted — replace the `setLevel` body with:

```javascript
  const setLevel = (modName, level) => {
    const cur = permissions[modName] || { level: 'none', can_download: false };
    const updated = { ...permissions, [modName]: { ...cur, level } };
    if (level === 'none') updated[modName].can_download = false;
    else if (!updated[modName].scope) updated[modName].scope = 'all';
    onChange(updated);
  };
```

Change the header grid (line 61-65) to four columns:

```javascript
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] bg-[var(--bg-primary)] px-3 py-2 border-b border-[var(--border-color)]">
        <span>Module</span>
        <span className="w-36 text-center">Permission Level</span>
        <span className="w-32 text-center">Data Scope</span>
        <span className="w-20 text-center">Download</span>
      </div>
```

Change the row grid class (line 73) from `grid-cols-[1fr_auto_auto]` to `grid-cols-[1fr_auto_auto_auto]`, and inside the row read the scope by adding after line 70:

```javascript
          const scope = perm.scope || 'all';
```

Then insert this cell between the Permission Level cell (ends line 85) and the Download cell (starts line 86):

```javascript
              <div className="w-32 px-1">
                <select value={scope} onChange={e => setScope(mod.name, e.target.value)}
                  disabled={level === 'none'}
                  data-testid={`scope-${mod.name}`}
                  className={`w-full h-8 px-2 rounded text-xs font-medium ${inputCls} ${scope === 'own' ? 'text-orange-400' : 'text-emerald-400'} disabled:opacity-40`}>
                  {SCOPES.map(s => (
                    <option key={s.value} value={s.value} className="text-[var(--text-primary)]">{s.label}</option>
                  ))}
                </select>
              </div>
```

- [ ] **Step 3: Remove the accounts and store matrix lockouts**

Delete the two blocks at lines 42-57 — the `if (disabled === 'accounts')` block and the `if (disabled === 'store')` block — in full. **Keep** the `if (disabled === 'admin')` block. This is the change that makes granting modules to store and accounts users possible at all.

- [ ] **Step 4: Replace the role Select with a checkbox group**

Change the component signature (line 98-106) to accept the new props:

```javascript
export function UserFormDialog({
  open, onOpenChange,
  editUser, form, setForm,
  showPassword, setShowPassword,
  allModules, allDesignations,
  handleDesignationChange,
  handlePermissionsChange,
  handleRolesChange,
  applyRolePresets,
  handleSave,
}) {
```

Replace the Role Level `<div>` (lines 153-163) with:

```javascript
            <div><Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Roles<FieldTooltip text="Tick every job this person does. Roles are presets — the permission matrix below is what actually applies." /></Label>
              <div className="grid grid-cols-2 gap-1.5">
                {ROLE_OPTIONS.map(r => {
                  const checked = (form.roles || []).includes(r.value);
                  const isAdminRole = r.value === 'admin';
                  const adminOn = (form.roles || []).includes('admin');
                  return (
                    <button key={r.value} type="button"
                      onClick={() => handleRolesChange(r.value)}
                      disabled={adminOn && !isAdminRole}
                      data-testid={`role-${r.value}`}
                      className={`px-2.5 py-2 rounded-lg border text-left transition-all disabled:opacity-40 ${checked ? 'border-[#e94560] bg-[#e94560]/10' : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'}`}>
                      <p className={`text-xs font-semibold ${checked ? 'text-[#e94560]' : textPri}`}>{r.label}</p>
                      <p className={`text-[10px] ${textMuted} leading-snug`}>{r.hint}</p>
                    </button>
                  );
                })}
              </div>
            </div>
```

- [ ] **Step 5: Update the two remaining `form.role` references**

The Sales Portal Role condition (line 167) becomes:

```javascript
          {(form.roles || []).includes('sales_person') && (
```

The quick-action condition (line 186) becomes:

```javascript
              {!(form.roles || []).includes('admin') && (
```

- [ ] **Step 6: Add the "Apply role presets" button**

Inside the quick-actions `<div className="flex gap-1">` (line 187), add as the first child, before the "All R+W" button:

```javascript
                  <button onClick={applyRolePresets} className="text-xs text-[#e94560] hover:underline">Apply role presets</button>
                  <span className={textMuted}>•</span>
```

Also update the "All R+W" handler so bulk-granting sets a scope (line 190):

```javascript
                    allModules.filter(m => m.is_active).forEach(m => { all[m.name] = { level: 'read_write', can_download: false, scope: 'all' }; });
```

- [ ] **Step 7: Point the matrix `disabled` prop at the roles array**

Replace line 202:

```javascript
              disabled={(form.roles || []).includes('admin') ? 'admin' : null}
```

- [ ] **Step 8: Verify the app compiles**

```bash
cd frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```

Expected: `Compiled successfully`.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/admin/UserFormDialog.js
git commit -m "feat(rbac): role checkboxes and per-module data-scope control in the user form"
```

---

### Task 8: User management form state and role chips

**Files:**
- Modify: `frontend/src/hooks/useUserManagement.js`
- Modify: `frontend/src/pages/admin/UserManagement.js`

**Interfaces:**
- Consumes: nothing from earlier frontend tasks beyond the props Task 7 expects.
- Produces: `handleRolesChange(role: string)` and `applyRolePresets()` on the hook's return object; `form.roles: string[]` in form state.

- [ ] **Step 1: Add `roles` to the form state**

In `frontend/src/hooks/useUserManagement.js`, change `emptyForm` (line 16-22):

```javascript
  const emptyForm = {
    email: '', password: '', name: '', role: 'sales_person', roles: ['sales_person'],
    sales_role: 'executive',
    designation: '', phone: '', calling_number: '',
    assigned_modules: [],
    module_permissions: {},
  };
```

Change `openEdit` (line 53-60) to hydrate `roles` from the user, falling back to the single role:

```javascript
    setForm({
      email: u.email, password: '', name: u.name, role: u.role,
      roles: (Array.isArray(u.roles) && u.roles.length) ? u.roles : [u.role || 'sales_person'],
      sales_role: u.sales_role || 'executive',
      designation: u.designation || '', phone: u.phone || '',
      calling_number: u.calling_number || '',
      assigned_modules: u.assigned_modules || [],
      module_permissions: u.module_permissions || {},
    });
```

- [ ] **Step 2: Add the preset tables and the two new handlers**

Add above `useUserManagement` in the same file:

```javascript
// Mirrors ROLE_DEFAULT_PERMISSIONS in backend/rbac.py. Kept in sync by hand —
// the backend is the real gate; this only pre-fills the matrix in the UI.
const RW  = { level: 'read_write',        can_download: true, scope: 'all' };
const RWD = { level: 'read_write_delete', can_download: true, scope: 'all' };
const R   = { level: 'read',              can_download: true, scope: 'all' };
const RW_OWN = { level: 'read_write', can_download: true, scope: 'own' };
const R_OWN  = { level: 'read',       can_download: true, scope: 'own' };

const ROLE_PRESETS = {
  accounts: {
    dashboard: R, quotations: RWD, orders: RW, procurement: RW,
    invoices: RWD, accounts: RW, payroll: RW, analytics: R,
    field_sales: R, hr: R, leave_management: RW, settings: R,
  },
  store: {
    dashboard: R, quotations: R, orders: RW, procurement: RW,
    inventory: RWD, stock_management: RW, purchase_alerts: RW,
    package_master: RW, physical_count: RW, store: RW,
    leave_management: RW, analytics: R,
  },
  sales_person: {
    dashboard: R_OWN, quotations: RW_OWN, leads: RW_OWN,
    field_sales: RW_OWN, sales_portal: RW_OWN,
    leave_management: RW_OWN, analytics: R_OWN,
  },
};

const LEVEL_RANK = { none: 0, read: 1, read_write: 2, read_write_delete: 3 };

function mergePresets(roles) {
  if (roles.includes('admin')) return {};
  const merged = {};
  roles.forEach(role => {
    Object.entries(ROLE_PRESETS[role] || {}).forEach(([mod, grant]) => {
      const cur = merged[mod];
      if (!cur) { merged[mod] = { ...grant }; return; }
      if (LEVEL_RANK[grant.level] > LEVEL_RANK[cur.level]) cur.level = grant.level;
      if (grant.scope === 'all') cur.scope = 'all';
      cur.can_download = cur.can_download || grant.can_download;
    });
  });
  return merged;
}

const PRIMARY_ROLE_ORDER = ['admin', 'accounts', 'store', 'sales_person'];
```

Then add the handlers inside the hook, after `handlePermissionsChange` (line 83):

```javascript
  // Toggle one role on/off. Admin is exclusive.
  const handleRolesChange = (role) => {
    setForm(prev => {
      const cur = prev.roles || [];
      let next;
      if (role === 'admin') {
        next = cur.includes('admin') ? [] : ['admin'];
      } else {
        next = cur.includes(role) ? cur.filter(r => r !== role) : [...cur.filter(r => r !== 'admin'), role];
      }
      if (!next.length) next = ['sales_person'];
      const primary = PRIMARY_ROLE_ORDER.find(r => next.includes(r));
      return { ...prev, roles: next, role: primary };
    });
  };

  // Re-merge the presets of every ticked role into the matrix, overwriting it.
  const applyRolePresets = () => {
    setForm(prev => {
      const merged = mergePresets(prev.roles || []);
      return {
        ...prev,
        module_permissions: merged,
        assigned_modules: Object.entries(merged).filter(([, p]) => p.level !== 'none').map(([m]) => m),
      };
    });
  };
```

- [ ] **Step 3: Send `roles` on save**

In `handleSave`, change the update payload (line 88-94):

```javascript
        const payload = {
          name: form.name, role: form.role, roles: form.roles, designation: form.designation,
          phone: form.phone, calling_number: form.calling_number,
          assigned_modules: form.assigned_modules,
          module_permissions: form.module_permissions,
          ...((form.roles || []).includes('sales_person') ? { sales_role: form.sales_role } : {}),
        };
```

The create path already spreads the whole form (`adminUsers.create({ ...form })`), so `roles` goes along automatically.

- [ ] **Step 4: Make the role filter multi-role aware and export the handlers**

Change `filteredUsers` (line 134-136):

```javascript
  const rolesOfUser = (u) => (Array.isArray(u.roles) && u.roles.length ? u.roles : [u.role]);

  const filteredUsers = roleFilter === 'all'
    ? users
    : users.filter(u => rolesOfUser(u).includes(roleFilter));
```

Add to the returned object (line 146-149):

```javascript
    handleDesignationChange,
    handlePermissionsChange,
    handleRolesChange,
    applyRolePresets,
    handleSave, handleDelete,
```

- [ ] **Step 5: Pass the new props through and show role chips**

In `frontend/src/pages/admin/UserManagement.js`, extend the destructure at line 28 to:

```javascript
    handlePermissionsChange,
    handleRolesChange,
    applyRolePresets,
```

Add a local helper next to the other class constants (after line 36):

```javascript
  const rolesOf = (u) => (Array.isArray(u.roles) && u.roles.length ? u.roles : [u.role || 'sales_person']);
```

Replace the single role badge at lines 147-149 with one chip per role:

```javascript
                        {rolesOf(u).map(r => (
                          <span key={r} className={`text-xs px-2 py-0.5 rounded-full font-medium border ${(ROLE_META[r] || ROLE_META.sales_person).cls}`}>
                            {(ROLE_META[r] || ROLE_META.sales_person).label}
                          </span>
                        ))}
```

Change the sales-role badge condition at line 150 to:

```javascript
                        {rolesOf(u).includes('sales_person') && u.sales_role && (
```

Change the admin check inside `getLevelBadge` at line 39 to:

```javascript
    if (rolesOf(u).includes('admin')) return (
```

`getLevelBadge` is defined above `rolesOf` in the file, so move the `rolesOf` definition above `getLevelBadge` (before line 38) rather than after line 36 if the linter complains about use-before-define.

Change the four filter-tab counts at lines 101-104 to count multi-role users:

```javascript
            { id: 'admin',        label: `Admin (${users.filter(u => rolesOf(u).includes('admin')).length})` },
            { id: 'accounts',     label: `Accounts (${users.filter(u => rolesOf(u).includes('accounts')).length})` },
            { id: 'store',        label: `Store (${users.filter(u => rolesOf(u).includes('store')).length})` },
            { id: 'sales_person', label: `Sales (${users.filter(u => rolesOf(u).includes('sales_person')).length})` },
```

Finally, add the two new props to the `<UserFormDialog ... />` element alongside the existing `handlePermissionsChange={handlePermissionsChange}`:

```javascript
            handleRolesChange={handleRolesChange}
            applyRolePresets={applyRolePresets}
```

- [ ] **Step 6: Verify the app compiles**

```bash
cd frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```

Expected: `Compiled successfully`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useUserManagement.js frontend/src/pages/admin/UserManagement.js
git commit -m "feat(rbac): multi-role form state, preset merge and role chips in user management"
```

---

### Task 9: End-to-end verification and deploy

**Files:**
- Modify: `frontend/build/**` (rebuilt bundle — committed, this repo serves the committed build)

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: a deployed release.

- [ ] **Step 1: Run the whole backend test suite**

```bash
cd backend && python -m pytest tests/ -v
```

Expected: PASS. Pre-existing failures unrelated to RBAC should be noted, not fixed here — but any failure in a file you touched must be resolved.

- [ ] **Step 2: Confirm the no-op guarantee for untouched users**

```bash
cd backend && python -c "
import rbac
legacy_sales = {'email':'a@b.c','role':'sales_person','module_permissions':{'quotations':{'level':'read_write'}}}
legacy_store = {'email':'d@e.f','role':'store','module_permissions':{'orders':{'level':'read_write'}}}
assert rbac.get_team(legacy_sales) == 'sales'
assert rbac.get_team(legacy_store) == 'store'
assert rbac.sees_all(legacy_sales,'quotations') is False
assert rbac.sees_all(legacy_store,'orders') is True
assert rbac.has_module(legacy_store,'leads') is False
print('legacy users unchanged: OK')
"
```

Expected: `legacy users unchanged: OK`. This is the guarantee that deploying changes nobody's access.

- [ ] **Step 3: Confirm the headline case resolves correctly**

```bash
cd backend && python -c "
import rbac
perms = rbac.default_permissions_for_roles(['sales_person','store'])
u = {'email':'g@h.i','role':'store','roles':['sales_person','store'],'module_permissions':perms}
assert rbac.get_teams(u) == {'sales','store'}
assert rbac.sees_all(u,'orders') is True,     'store work needs all orders'
assert rbac.sees_all(u,'leads') is False,     'CRM stays own-scoped'
assert rbac.has_module(u,'leads','read_write') is True, 'CRM is reachable'
assert rbac.has_module(u,'inventory','read_write') is True
print('sales+store resolves correctly: OK')
"
```

Expected: `sales+store resolves correctly: OK`.

- [ ] **Step 4: Manual click-through against a local backend**

Start the backend and frontend, log in as `info@smartshape.in`, then verify:

1. Admin → User Management → edit any store user. **The permission matrix now renders** instead of the "No CRM access" banner.
2. Tick **Sales** alongside **Store**, click **Apply role presets**, confirm `Leads` appears with scope `Own records` and `Orders` with `All records`.
3. Save, reload the list, confirm two role chips show on that user.
4. Log in as that user: CRM opens and shows only their own leads; Orders shows every order.
5. Log in as an untouched sales user: everything behaves exactly as before.

Record the result of each of the five checks. Do not proceed to deploy on a failure.

- [ ] **Step 5: Build the production bundle**

```bash
cd frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```

Expected: `Compiled successfully`. Note the new `main.<hash>.js` filename.

- [ ] **Step 6: Commit source and build explicitly**

Never `git add -A` here — it would sweep in gitignored test files and local artifacts.

```bash
git add frontend/build
git commit -m "build: multi-role RBAC bundle"
```

- [ ] **Step 7: Push and wait for the auto-deploy**

```bash
git push origin main
```

The VPS timer picks it up in roughly 1-2 minutes. Verify by fetching the deployed bundle and confirming it is the hash from Step 5 — verify by content, not by the deploy script's exit code.

- [ ] **Step 8: Run the backfill against production**

Dry run first, read the output, then apply:

```bash
cd backend && python migrations/backfill_user_roles_scope.py
cd backend && python migrations/backfill_user_roles_scope.py --apply
```

Expected: the apply run reports the same count as the dry run; a second dry run afterwards reports `0 of N users would be updated`.

- [ ] **Step 9: Post-deploy smoke check**

Log in to production as `info@smartshape.in`, open User Management, and confirm the role chips and permission matrix render for a store user. Confirm one existing sales user's CRM still lists their leads.

---

## Notes for the implementer

- **Do not touch the other ~100 `get_team()` call sites.** They keep working via the highest-privilege rule. Widening them is out of scope.
- **`scope` only means something for modules that have owned records** — leads, contacts, schools, quotations, orders. For `dashboard` or `settings` it is stored but unused. That is fine; do not add special-casing.
- **The frontend `ROLE_PRESETS` table duplicates `backend/rbac.py`'s `ROLE_DEFAULT_PERMISSIONS`.** This duplication is deliberate — the button needs to pre-fill the matrix without a round trip, and the backend remains the real gate. If you change one, change the other.
- **If a test file will not stage,** that is the `backend/tests/` gitignore on `main`. Use `git add -f`.
