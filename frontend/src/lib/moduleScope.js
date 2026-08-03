// Data-scope defaulting for the User Management permission matrix.
//
// EXACT mirror of the backend fallback in backend/rbac.py `module_scope`:
//
//     if has_team(user, "admin"):      return "all"
//     scope = grant.get("scope")
//     if scope in ("own", "all"):      return scope
//     return "own" if get_teams(user) == {"sales"} else "all"
//
// A grant with no explicit `scope` — every pre-backfill user — resolves server-
// side by the legacy role rule, NOT to a hard-coded "all". The matrix must show
// the same answer the backend will give, and must not silently widen a sales
// rep from own-scoped to org-wide just because an admin edited an unrelated row.

const VALID_ROLES = ['admin', 'accounts', 'store', 'sales_person'];

// rbac.py `_ROLE_TEAM`
const ROLE_TEAM = {
  admin: 'admin',
  accounts: 'accounts',
  store: 'store',
  sales_person: 'sales',
};

/** The scope a grant with no explicit `scope` resolves to, for these roles. */
export function defaultScopeForRoles(roles) {
  // rbac.py `get_roles`: drop unknown roles, fall back to sales_person when none survive.
  let held = Array.from(new Set((roles || []).filter(r => VALID_ROLES.includes(r))));
  if (!held.length) held = ['sales_person'];
  // rbac.py `module_scope`: admin short-circuits to "all" before the fallback.
  if (held.includes('admin')) return 'all';
  // rbac.py `get_teams(user) == {"sales"}`
  const teams = new Set(held.map(r => ROLE_TEAM[r]));
  return teams.size === 1 && teams.has('sales') ? 'own' : 'all';
}
