import { useAuth } from '../contexts/AuthContext';

// The single owner account allowed to perform irreversible deletes (orders, and
// cascade-deleting a school/contact with all related data). Must match the backend
// SUPERADMIN_EMAIL in rbac.py. The backend is the real gate; this only hides UI.
export const OWNER_EMAIL = 'info@smartshape.in';

/**
 * True only for the owner account (info@smartshape.in). Use to show owner-only
 * destructive actions. Server-side require_superadmin still enforces the rule.
 */
export function useIsOwner() {
  const { user } = useAuth();
  return (user?.email || '').trim().toLowerCase() === OWNER_EMAIL;
}

// role -> logical team. Mirrors backend rbac.py _ROLE_TEAM.
const ROLE_TEAM = {
  admin: 'admin',
  accounts: 'accounts',
  store: 'store',
  sales_person: 'sales',
};
// Highest privilege last. Mirrors backend rbac.py _TEAM_RANK.
const TEAM_RANK = { sales: 0, store: 1, accounts: 2, admin: 3 };

/** Every role the user holds. Falls back to the legacy single `role` string,
 *  mirroring the backend's get_roles(). */
function rolesOf(user) {
  const list = Array.isArray(user?.roles) ? user.roles.filter(r => ROLE_TEAM[r]) : [];
  if (list.length) return list;
  return [user?.role || 'sales_person'];
}

/** Every role (string) the current user holds, e.g. ['sales_person', 'store']. */
export function useRoles() {
  const { user } = useAuth();
  return user ? rolesOf(user) : [];
}

/** Every logical team the current user belongs to, e.g. ['sales', 'store']. */
export function useTeams() {
  const { user } = useAuth();
  if (!user) return ['guest'];
  return [...new Set(rolesOf(user).map(r => ROLE_TEAM[r] || 'sales'))];
}

/**
 * Returns the logical team for the current user.
 *   'admin'    – full access to everything
 *   'accounts' – all quotations/orders/payments; no CRM
 *   'store'    – all orders/dispatches/inventory; no CRM
 *   'sales'    – own data only
 *
 * For a multi-role user this returns the highest-privilege team held,
 * mirroring the backend get_team(). Signature/behavior unchanged for
 * single-role users.
 */
export function useTeam() {
  const { user } = useAuth();
  if (!user) return 'guest';
  return rolesOf(user)
    .map(r => ROLE_TEAM[r] || 'sales')
    .reduce((best, t) => (TEAM_RANK[t] > TEAM_RANK[best] ? t : best), 'sales');
}

const NONE = { canView: false, canWrite: false, canDelete: false, canDownload: false };

/**
 * Returns permission flags for a given module.
 *
 * Capability is the UNION of:
 *   1) the user's explicit per-module grant (module_permissions) — the source of
 *      truth going forward, mirroring the backend `require_module` gate; and
 *   2) legacy role defaults (kept additively so nothing a team sees today
 *      disappears during rollout).
 *
 * This lets an admin grant any user any module (e.g. accounts → procurement) and
 * have the UI surface it, while existing role-based menus keep working.
 *
 * Also returns `scope` ('own' | 'all') and `seesAll` (scope === 'all'), mirroring
 * the backend's module_scope(): the explicit grant scope when set, else the
 * legacy rule (sales-only user → 'own', everyone else → 'all').
 */
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
