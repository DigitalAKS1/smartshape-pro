# Multi-Role Users with Per-Module Data Scope — Design

**Date:** 2026-08-03
**Status:** Approved for planning
**Target branch:** `main` (build in worktree `F:/ss-work`). NOT `feat/module-rbac`, which is a stale fork and must never be merged.

---

## 1. Problem

A user can hold exactly one role today (`admin` / `accounts` / `store` / `sales_person`). Real staff do two
jobs — a store keeper who also chases leads, an accounts person who also handles dispatch. There is no way
to express that.

Two separate mechanisms already exist, and only one of them is flexible:

| Mechanism | Decides | File | Flexible today? |
|---|---|---|---|
| `role` → `get_team()` | **What data you SEE** | `backend/rbac.py:21` (~107 call sites) | No — single string |
| `module_permissions` → `require_module()` | **What you can DO** | `backend/rbac.py:73` | Yes — per module, per level |

So capability is already multi-role-capable. The blockers are:

1. **Data scope is welded to the single role string.** `sales` sees only own records; `accounts`/`store` see
   org-wide but are hard-blocked from CRM at `crm_routes.py:787,809,827,940,1055,1686,2322,2376,2608,2650,2704`.
   Granting a store user the `leads` module changes nothing — the CRM helpers still return `False`/`[]`.
2. **The admin UI hides the permission matrix for `accounts` and `store`.**
   `frontend/src/components/admin/UserFormDialog.js:42-57` renders a static "No CRM access" banner
   instead of the grant matrix. An admin cannot grant those users anything, even though the backend would honour it.

## 2. Decision

Roles become **presets**, not gates. `module_permissions` becomes the single source of truth for both
capability *and* data scope, by adding a `scope` field to each grant.

Rejected alternatives:

- **Union of roles (widest wins).** Simple, but a sales exec given Store would gain sight of every other
  exec's quotations. Too blunt.
- **Full replacement — delete `role` from enforcement.** Cleanest end state but rewrites all ~107
  `get_team()` sites at once across live CRM, quotations, orders and inventory. Unacceptable blast radius
  for a single change on a production system.

## 3. Data model

All changes are additive to the `users` collection.

```jsonc
{
  "role":  "sales_person",                // PRIMARY — derived, retained for back-compat
  "roles": ["sales_person", "store"],     // NEW — which presets are applied
  "module_permissions": {
    "leads":  { "level": "read_write", "scope": "own", "can_download": true },
    "orders": { "level": "read_write", "scope": "all", "can_download": true }
  }
}
```

**`role` is never removed.** It is recomputed on every save as `"admin"` if `admin ∈ roles`, else `roles[0]`.
This keeps the ~100 legacy `user.get("role")` and `get_team()` call sites working with zero edits.

**`scope`** is `"own"` | `"all"`. When the key is absent it resolves from the legacy role:
`sales_person` → `own`, every other role → `all`. Therefore **every existing user behaves bit-identically**
until an admin explicitly edits them.

`sales_role` (manager/executive/trainee) is stored but never used for scoping and there is no reporting
hierarchy in the system, so no `"team"` scope value is introduced. YAGNI.

## 4. `backend/rbac.py` — new API

Additive. No existing function changes signature.

| Function | Returns | Notes |
|---|---|---|
| `get_roles(user)` | `list[str]` | `user["roles"]`, falling back to `[user["role"]]` |
| `get_teams(user)` | `set[str]` | roles mapped through the existing role→team rule |
| `has_team(user, team)` | `bool` | membership test |
| `get_team(user)` | `str` | **unchanged signature**; now returns the highest-privilege team in the set, ordered `admin > accounts > store > sales` |
| `require_teams(user, *teams)` | – | now passes when `get_teams(user) & set(teams)` is non-empty |
| `module_scope(user, module)` | `"own"\|"all"` | grant's `scope`, else legacy-role fallback; `admin` → `"all"` |
| `sees_all(user, module)` | `bool` | `module_scope(...) == "all"` |
| `has_module(user, module, level="read")` | `bool` | non-raising sibling of `require_module`; honours the admin bypass |
| `default_permissions_for_roles(roles)` | `dict` | merges presets: **max** level, **widest** scope, **OR** of `can_download` |

`default_permissions_for_role(role)` is kept as a one-element wrapper so nothing that calls it breaks.

`ROLE_DEFAULT_PERMISSIONS` gains an explicit `scope` on every entry — `sales_person` grants get
`scope: "own"`, `accounts` and `store` grants get `scope: "all"`. This makes the presets self-describing
rather than relying on the fallback rule.

`MODULE_RBAC_MODE` and the `shadow`/`enforce` switch are untouched.

## 5. Enforcement rewiring

Roughly 20 lines change. Everything else keeps calling `get_team()`.

### 5a. Own-record data filters — 7 sites

`quotation_routes.py:370,579,656,682`, `order_routes.py:109,948,1112`

```python
# before
if team == "sales":
    query["sales_person_email"] = user["email"]

# after
if not sees_all(user, "quotations"):
    query["sales_person_email"] = user["email"]
```

The module per site is the one that endpoint already gates on: `quotations` for quotation routes, `orders`
for order routes.

### 5a-bis. Owner escape hatch — 1 site

`customer_routes.py:252` is not a filter but a bypass: the owning sales person may edit a catalogue
selection without holding the `quotations` grant. The `team == "sales"` half of the condition is redundant
once scope is per-module, so it reduces to the ownership test alone:

```python
# before
if not (team == "sales" and owns):
    require_module(user, "quotations", "read_write")

# after
if not owns:
    require_module(user, "quotations", "read_write")
```

### 5b. CRM blocks — 11 sites in `crm_routes.py`

The `team in ("accounts", "store")` blocks collapse into one pattern gated on the existing `leads` module
(no new module name is invented):

```python
# list endpoints (1055, 1686, 2322, 2376)
if not has_module(user, "leads"):
    return []
if sees_all(user, "leads"):
    query = {}
else:
    query = <existing own-scope query>

# mutation guards (787, 809, 827, 940, 2608, 2650, 2704)
if not has_module(user, "leads", "read_write"):
    return False
if sees_all(user, "leads"):
    return True
<existing ownership checks>
```

Admin still short-circuits first via the existing `team == "admin"` branch.

**Consequence to be explicit about:** an `accounts` or `store` user with no `leads` grant keeps getting `[]`
and `False`, exactly as today. Access only appears when an admin grants the module.

## 6. Admin API — `backend/routes/admin_routes.py`

`POST /admin/users` and `PUT /admin/users/{id}`:

- Accept a `roles` array; validate each entry against `("admin","accounts","store","sales_person")` and drop
  unknown values. Empty after validation → `["sales_person"]`.
- **Admin is exclusive:** if `admin ∈ roles`, store `roles = ["admin"]`.
- Derive and store `role` as the primary (see §3).
- Accept `roles` on the existing allowed-fields list at `admin_routes.py:203`.
- If the client sends `module_permissions`, honour it verbatim. Otherwise generate it from
  `default_permissions_for_roles(roles)`.
- Keep the existing `assigned_modules` sync (`admin_routes.py:146-148, 207-209`) — it derives from
  `module_permissions` and stays correct unchanged.
- `sales_role` is stored when `sales_person ∈ roles` (today: `role == "sales_person"`).

`GET /admin/users` and the auth `/me` payload return `roles` alongside `role`.

## 7. Frontend

### `frontend/src/hooks/usePermission.js`

- Add `useRoles()` and `useTeams()`.
- `useTeam()` keeps returning a single team — the highest-privilege one — mirroring the backend.
- `usePermission(module)` gains a `scope` field in its return object, and its legacy role-default block
  (lines 66-82) is evaluated **per role and unioned**, not against a single team.

### `frontend/src/components/admin/UserFormDialog.js`

- Role `<Select>` (line 154) → a checkbox group. Ticking **Admin** clears and disables the others.
- **Delete the `accounts` and `store` matrix lockouts (lines 42-57).** The matrix renders for every
  non-admin combination. The Admin banner stays.
- Each module row in `PermMatrix` gains a **Scope** control: *Own records* / *All records*, disabled when
  level is `none`. Default for a newly-granted module follows the preset merge.
- An **Apply role presets** button re-merges `default_permissions_for_roles(roles)` into the current matrix
  so an admin can tick a second role and pull in its defaults without hand-editing every row.
- `sales_role` picker (line 167) shows when `sales_person` is ticked.

### `frontend/src/pages/admin/UserManagement.js` / `hooks/useUserManagement.js`

- Carry `roles` through form state and the save payload.
- The user list shows one chip per role instead of a single role label.

The module list itself is already DB-driven via the Module Master API, so no hard-coded list needs touching.

## 8. Migration

**Not required** — the §3 fallbacks make the change invisible to existing users.

One optional, idempotent, non-destructive backfill is recommended so the database is self-describing rather
than relying on inference: for every user missing `roles`, set `roles = [role]`; for every grant missing
`scope`, write the value the fallback would have produced. Re-runnable; writes nothing that changes
behaviour. Ship it as a script under `backend/migrations/`, following
`backfill_module_permissions.py`.

## 9. Testing

Extend `backend/tests/test_rbac_module.py`:

- `module_scope` fallback matrix — grant with `scope`, grant without `scope` for each legacy role, admin.
- `default_permissions_for_roles(["sales_person","store"])` — max level, widest scope, OR'd download.
- `require_teams` intersection — a `store`+`sales_person` user passes a `("sales",)` gate.
- Admin exclusivity — saving `["admin","store"]` stores `["admin"]`.
- The headline case end-to-end: a Sales+Store user sees **all** orders but only **own** leads.
- Regression: a single-role user with no `roles` and no `scope` keys resolves identically to today.

**Gotcha:** `backend/tests/` is gitignored on `main`, so `git add backend/tests/...` silently
short-circuits. Use `git add -f` or accept that the tests stay local.

## 10. Rollout

- `MODULE_RBAC_MODE` stays `enforce`. This change does not widen anyone's access on deploy.
- Behaviour changes only when an admin ticks a second role or edits a scope.
- Deploy per the standard mechanism: commit source **and** the rebuilt bundle explicitly in `F:/ss-work`
  (never `git add -A`), build with `DISABLE_ESLINT_PLUGIN=true` and an inline
  `REACT_APP_BACKEND_URL=https://app.smartshape.in`.

## 11. Out of scope

- Manager-sees-team's-data (`scope: "team"`) — no reporting hierarchy exists.
- Per-record sharing or ACLs.
- Reworking the remaining ~100 `get_team()` call sites; they keep working via the highest-privilege rule.
